import { cookies, headers } from "next/headers";
import { studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";
import { authoriseStudio, assertStudioRequestHost, studioReadScope, studioSignIn } from "../lib/auth";
import { studioPageTrace } from "../lib/data-trace";
import { StudioProblem } from "../lib/problem";
import { localStudioCheckerOrigin, localStudioSafetyAvailable, stagedStudioSafetyAvailable, studioRuntime } from "../lib/runtime";
import Studio from "../components/studio";
import { StudioReadProvider } from "../components/studio-reads";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return studioPageTrace(async () => { try {
    const runtime = studioRuntime();
    assertStudioRequestHost(runtime, (await headers()).get("host"));
    const cookie = (await cookies()).get(runtime.name)?.value;
    const actor = await authoriseStudio(cookie, runtime);
    const scope = studioReadScope(actor, cookie, runtime);
    const { page } = await searchParams;
    const localReview = localStudioSafetyAvailable();
    const stagedReview = stagedStudioSafetyAvailable();
    return <StudioReadProvider key={scope} scope={scope}><Studio actor={actor} demo={runtime.fixture}
      initialPage={page === "library" ? "dishes" : page === "catalogue" ? "products" : "home"}
      safetyAvailable={localReview || stagedReview} publishedKitchenAvailable={localReview}
      checkerOrigin={stagedReview ? studioReviewStaging.cpuOrigin : localStudioCheckerOrigin()} /></StudioReadProvider>;
  } catch (error) {
    const signIn = error instanceof StudioProblem && error.status === 401 ? studioSignIn(studioRuntime(), error) : null;
    const message = error instanceof StudioProblem ? error.message : "Studio could not be opened.";
    return <main className="studio-admission fika-card">
      <h1>Hospitality Menu Studio</h1>
      <p>{message}</p>
      {signIn && <a className="fika-button fika-button--primary" href={signIn}>Open FIKA OS sign-in</a>}
    </main>;
  } });
}
