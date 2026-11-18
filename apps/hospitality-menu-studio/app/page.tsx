import { cookies, headers } from "next/headers";
import { authoriseStudio, assertLocalPreviewHost } from "../lib/auth";
import { StudioProblem } from "../lib/problem";
import { studioRuntime } from "../lib/runtime";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const runtime = studioRuntime();
    assertLocalPreviewHost(runtime, (await headers()).get("host"));
    const actor = await authoriseStudio((await cookies()).get(runtime.name)?.value, runtime);
    return <main className="studio-admission fika-card">
      <h1>Hospitality Menu Studio</h1>
      <p>{actor.canManage ? "Your authoring workspace is connected." : "Your workspace is available in read-only mode."}</p>
    </main>;
  } catch (error) {
    const signIn = error instanceof StudioProblem && error.status === 401;
    const message = error instanceof StudioProblem ? error.message : "Studio could not be opened.";
    return <main className="studio-admission fika-card">
      <h1>Hospitality Menu Studio</h1>
      <p>{message}</p>
      {signIn && <a className="fika-button fika-button--primary" href={studioRuntime().hub}>Open FIKA OS sign-in</a>}
    </main>;
  }
}
