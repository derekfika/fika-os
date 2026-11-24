param([Parameter(Mandatory)][string]$ScanRoot, [string]$CandidatesFile)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($ScanRoot)
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))
if ($drive.DriveFormat -ne 'NTFS') { throw 'Physical allocation reporting requires NTFS' }
if ((Get-Item -LiteralPath $root).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
    throw 'The scan root must be a physical directory'
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class FikaDiskInventory {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int infoClass, IntPtr data, uint size);

    public sealed class Usage {
        public long AllocatedBytes { get; set; }
        public long Files { get; set; }
        public long Directories { get; set; }
    }

    public sealed class Report {
        public long AllocatedBytes { get; set; }
        public long DuplicateHardlinks { get; set; }
        public long SkippedReparsePoints { get; set; }
        public long UnreadableDirectories { get; set; }
        public long CandidateAllocatedBytesUpperBound { get; set; }
        public long Files { get; set; }
        public long Directories { get; set; }
        public Dictionary<string, Usage> Areas { get; } = new Dictionary<string, Usage>(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, Usage> Categories { get; } = new Dictionary<string, Usage>(StringComparer.OrdinalIgnoreCase);
        public List<string> GitDirectories { get; } = new List<string>();
        public long DependencyDirectories { get; set; }
        public List<string> DirectoryErrors { get; } = new List<string>();
    }

    private sealed class Folder {
        public string Path, Area, Category;
        public bool Candidate;
    }

    private static readonly Dictionary<string, string> CategoryNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        {"node_modules", "installed dependencies"}, {"npm", "npm download cache"}, {"pnpm", "pnpm store"},
        {"_cacache", "npm download cache"}, {"emulators", "Firebase emulator cache"}, {"firebase-emulators", "Firebase emulator cache"},
        {"ms-playwright", "browser binaries"}, {"playwright-browsers", "browser binaries"}, {".next", "Next.js builds"},
        {"dist", "build outputs"}, {"coverage", "coverage"}, {"test-results", "test results"},
        {"agent-test-results", "test results"}, {"playwright-report", "browser reports"}, {"_scratch", "scratch"},
        {".claude", "Claude"}, {".codex", "Codex"}, {".git", "Git metadata"}
    };

    private static Usage GetUsage(Dictionary<string, Usage> index, string key) {
        Usage usage;
        if (!index.TryGetValue(key, out usage)) index.Add(key, usage = new Usage());
        return usage;
    }

    public static Report Read(string root, string[] candidates) {
        var result = new Report();
        var seen = new HashSet<long>();
        var candidateIds = new HashSet<long>();
        var candidatePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string candidate in candidates ?? new string[0]) candidatePaths.Add(Path.GetFullPath(candidate));
        var folders = new Stack<Folder>();
        folders.Push(new Folder { Path = root, Area = ".", Category = "other", Candidate = candidatePaths.Contains(root) });
        const int bufferSize = 65536;
        IntPtr buffer = Marshal.AllocHGlobal(bufferSize);
        try {
            while (folders.Count > 0) {
                Folder folder = folders.Pop();
                result.Directories++;
                Usage area = GetUsage(result.Areas, folder.Area);
                Usage category = GetUsage(result.Categories, folder.Category);
                area.Directories++;
                category.Directories++;
                try {
                    // List-only directory handle. OPEN_REPARSE_POINT prevents redirection if the entry changes.
                    using (SafeFileHandle handle = CreateFile(@"\\?\" + folder.Path, 1, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
                        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                        while (GetFileInformationByHandleEx(handle, 10, buffer, bufferSize)) {
                            // FILE_ID_BOTH_DIR_INFO uses fixed-width fields before its UTF-16 filename.
                            int next;
                            for (IntPtr entry = buffer; ; entry = IntPtr.Add(entry, next)) {
                                next = Marshal.ReadInt32(entry);
                                int attributes = Marshal.ReadInt32(entry, 56);
                                if ((attributes & 0x400) != 0) result.SkippedReparsePoints++;
                                else if ((attributes & 0x10) != 0) {
                                    string name = Marshal.PtrToStringUni(IntPtr.Add(entry, 104), Marshal.ReadInt32(entry, 60) / 2);
                                    if (name != "." && name != "..") {
                                        string child = Path.Combine(folder.Path, name);
                                        if (name.Equals(".git", StringComparison.OrdinalIgnoreCase)) result.GitDirectories.Add(folder.Path);
                                        if (name.Equals("node_modules", StringComparison.OrdinalIgnoreCase)) result.DependencyDirectories++;
                                        string childArea = folder.Area;
                                        if (folder.Path == root || folder.Area == "agent-workspaces" || folder.Area == @"agent-workspaces\fika-os")
                                            childArea = folder.Area == "." ? name : Path.Combine(folder.Area, name);
                                        string childCategory;
                                        if (folder.Category != "other" || !CategoryNames.TryGetValue(name, out childCategory))
                                            childCategory = folder.Category;
                                        folders.Push(new Folder { Path = child, Area = childArea, Category = childCategory,
                                            Candidate = folder.Candidate || candidatePaths.Contains(child) });
                                    }
                                } else {
                                    result.Files++;
                                    area.Files++;
                                    category.Files++;
                                    long id = Marshal.ReadInt64(entry, 96);
                                    long allocated = Marshal.ReadInt64(entry, 48);
                                    if (folder.Candidate && (id == 0 || candidateIds.Add(id))) result.CandidateAllocatedBytesUpperBound += allocated;
                                    if (id == 0 || seen.Add(id)) {
                                        result.AllocatedBytes += allocated;
                                        area.AllocatedBytes += allocated;
                                        category.AllocatedBytes += allocated;
                                    } else result.DuplicateHardlinks++;
                                }
                                if (next == 0) break;
                            }
                        }
                        int error = Marshal.GetLastWin32Error();
                        if (error != 18) throw new Win32Exception(error); // ERROR_NO_MORE_FILES
                    }
                } catch (Win32Exception error) {
                    result.UnreadableDirectories++;
                    if (result.DirectoryErrors.Count < 20)
                        result.DirectoryErrors.Add(folder.Area + " (Win32 " + error.NativeErrorCode + ")");
                }
            }
        } finally { Marshal.FreeHGlobal(buffer); }
        return result;
    }
}
'@

$Candidates = if ($CandidatesFile) { Get-Content -LiteralPath $CandidatesFile -Raw | ConvertFrom-Json }
$report = [FikaDiskInventory]::Read($root, $Candidates)
[ordered]@{
    scanRoot = $root
    volumeFreeBytes = $drive.AvailableFreeSpace
    fileAllocationBytes = $report.AllocatedBytes
    files = $report.Files
    directories = $report.Directories
    dependencyDirectories = $report.DependencyDirectories
    gitDirectories = $report.GitDirectories
    hardlinkAliasesDeduplicated = $report.DuplicateHardlinks
    reparsePointsSkipped = $report.SkippedReparsePoints
    unreadableDirectories = $report.UnreadableDirectories
    directoryErrors = $report.DirectoryErrors
    reclaimableAllocationUpperBoundBytes = $report.CandidateAllocatedBytesUpperBound
    categories = $report.Categories
    areas = $report.Areas
} | ConvertTo-Json -Depth 6 -Compress
