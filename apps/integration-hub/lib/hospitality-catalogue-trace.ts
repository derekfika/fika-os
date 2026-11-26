import { setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";

export function hospitalityTraceRequestId(request: Request) {
  const incomingId = request.headers.get("x-fika-data-request-id");
  return incomingId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incomingId)
    ? incomingId : undefined;
}

export function traceHospitalityCatalogue(
  request: Request,
  action: string,
  path: string,
  respond: () => Promise<Response>,
) {
  return withDataTrace({ app: "integration-hub", action: "hospitality-catalogue." + action, path, requestId: hospitalityTraceRequestId(request) }, async () => {
    const response = await respond();
    if (response.ok || response.status === 304) setDataTraceOutcome("SUCCESS");
    else if (response.status === 401 || response.status === 403) setDataTraceOutcome("DENIED");
    else if (response.status === 404) setDataTraceOutcome("NOT_FOUND");
    else setDataTraceOutcome("ERROR");
    return response;
  });
}
