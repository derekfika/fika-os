"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main role="alert" aria-labelledby="app-error-title"><h1 id="app-error-title">We couldn’t load this screen.</h1><p>Something went wrong while loading Ad-Hoc Production. Please try again.</p><button type="button" onClick={() => reset()}>Try again</button><p><Link href="/">Return to Ad-Hoc Production</Link></p></main>;
}
