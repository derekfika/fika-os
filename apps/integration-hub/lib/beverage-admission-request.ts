import type { Firestore } from "firebase-admin/firestore";
import { decideBeverageSiteAuthority, type BeverageSiteRequest } from "./authmod-core/beverage-admission";
import { FirestoreAuthModRepository } from "./authmod-core/firestore-repository";
import { auth, db } from "./firebase-admin";
import { sessionCookieConfig } from "./runtime-config";

type Dependencies = {
  auth: { verifySessionCookie(cookie: string, checkRevoked: true): Promise<{ uid: string }> };
  firestore: Pick<Firestore, "runTransaction">;
};

/** Internal Hub request adapter. Hosted routes and registry provisioning are separate. */
export function decideBeverageRequestAuthority(
  request: { cookies: { get(name: string): { value?: string } | undefined } },
  input: BeverageSiteRequest,
  dependencies: Dependencies = { auth, firestore: db },
) {
  const sessionCookie = request.cookies.get(sessionCookieConfig().name)?.value;
  return decideBeverageSiteAuthority(
    read => dependencies.firestore.runTransaction(transaction => {
      const repository = new FirestoreAuthModRepository("beverage-admission", undefined, transaction);
      return read({
        findIdentitiesByExternal: (provider, uid, limit) => repository.findIdentitiesByExternal(provider, uid, limit),
        getApplication: appId => repository.getApplication(appId),
        getActiveOploc: oplocId => repository.getActiveOploc(oplocId),
        readCurrentAccessPackage: identityId => repository.getRuntimeAccessPackage(identityId),
        readCurrentOplocRedirects: () => repository.listOplocRedirects(),
      });
    }, { readOnly: true }),
    (cookie, checkRevoked) => dependencies.auth.verifySessionCookie(cookie, checkRevoked),
    { ...input, sessionCookie },
  );
}
