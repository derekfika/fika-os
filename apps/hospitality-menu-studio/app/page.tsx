import { cookies, headers } from "next/headers";
import { authoriseStudio, assertStudioRequestHost, studioSignIn } from "../lib/auth";
import { StudioProblem } from "../lib/problem";
import { studioRuntime } from "../lib/runtime";
import Studio from "../components/studio";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const runtime = studioRuntime();
    assertStudioRequestHost(runtime, (await headers()).get("host"));
    const actor = await authoriseStudio((await cookies()).get(runtime.name)?.value, runtime);
    return <Studio actor={actor} demo={runtime.fixture} />;
  } catch (error) {
    const signIn = error instanceof StudioProblem && error.status === 401 ? studioSignIn(studioRuntime(), error) : null;
    const message = error instanceof StudioProblem ? error.message : "Studio could not be opened.";
    return <main className="studio-admission fika-card">
      <h1>Hospitality Menu Studio</h1>
      <p>{message}</p>
      {signIn && <a className="fika-button fika-button--primary" href={signIn}>Open FIKA OS sign-in</a>}
    </main>;
  }
}
