import { OrderForm } from "../../order-form";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OrderForm id={decodeURIComponent(id)} />; }
