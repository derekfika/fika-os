import AccountDetail from "./AccountDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <AccountDetail id={(await params).id} />;
}
