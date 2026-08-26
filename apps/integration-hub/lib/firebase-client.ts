"use client";

import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function hasFikaFirebaseClientConfig() { return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId); }

export function getFikaFirebaseAuth() {
  if (!hasFikaFirebaseClientConfig()) throw new Error("Firebase web configuration is not available.");
  return getAuth(getApps()[0] || initializeApp(config));
}

export function getFikaGoogleProvider() { return new GoogleAuthProvider(); }
