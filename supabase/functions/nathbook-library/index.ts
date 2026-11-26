import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const serviceKey = secretKeys.default ?? Object.values(secretKeys)[0];

const userClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = createClient(supabaseUrl, serviceKey as string, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "Connexion requise." }, 401);

  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return json({ error: "Session invalide. Reconnecte-toi." }, 401);

  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("id,user_id,status,total_amount,currency,payment_provider,payment_reference,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (ordersError) {
    console.error("NATHBOOK library orders:", ordersError);
    return json({ error: "Impossible de récupérer tes commandes." }, 500);
  }

  const orderList = orders ?? [];
  const orderIds = orderList.map((order) => order.id);
  let items: any[] = [];

  if (orderIds.length) {
    const { data, error } = await admin
      .from("order_items")
      .select("id,order_id,ebook_id,pack_id,title_snapshot,unit_price")
      .in("order_id", orderIds);
    if (error) {
      console.error("NATHBOOK library items:", error);
      return json({ error: "Impossible de récupérer le contenu des commandes." }, 500);
    }
    items = data ?? [];
  }

  const paidOrderIds = new Set(orderList.filter((order) => order.status === "paid").map((order) => order.id));
  const paidItems = items.filter((item) => paidOrderIds.has(item.order_id));
  const directEbookIds = paidItems.map((item) => item.ebook_id).filter(Boolean);
  const packIds = [...new Set(paidItems.map((item) => item.pack_id).filter(Boolean))];

  let packLinks: any[] = [];
  if (packIds.length) {
    const { data, error } = await admin
      .from("pack_ebooks")
      .select("pack_id,ebook_id,position")
      .in("pack_id", packIds);
    if (error) {
      console.error("NATHBOOK library pack links:", error);
      return json({ error: "Impossible de récupérer le contenu des packs." }, 500);
    }
    packLinks = data ?? [];
  }

  const ebookIds = [...new Set([
    ...directEbookIds,
    ...packLinks.map((link) => link.ebook_id).filter(Boolean),
  ])];

  let ebooks: any[] = [];
  if (ebookIds.length) {
    const { data, error } = await admin
      .from("ebooks")
      .select("id,title,description,cover_path,pdf_path")
      .in("id", ebookIds);
    if (error) {
      console.error("NATHBOOK library ebooks:", error);
      return json({ error: "Impossible de récupérer les ebooks achetés." }, 500);
    }
    ebooks = data ?? [];
  }

  const books = await Promise.all(ebooks.map(async (ebook) => {
    let cover_url: string | null = null;
    let download_url: string | null = null;

    if (ebook.cover_path) {
      const { data } = await admin.storage.from("ebooks").createSignedUrl(ebook.cover_path, 3600);
      cover_url = data?.signedUrl ?? null;
    }
    if (ebook.pdf_path) {
      const { data, error } = await admin.storage.from("ebooks").createSignedUrl(ebook.pdf_path, 1800);
      if (error) console.error("NATHBOOK signed PDF:", error);
      download_url = data?.signedUrl ?? null;
    }

    return {
      id: ebook.id,
      title: ebook.title,
      description: ebook.description,
      cover_url,
      download_url,
    };
  }));

  return json({
    books,
    orders: orderList.map((order) => ({
      id: order.id,
      status: order.status,
      total_amount: order.total_amount,
      currency: order.currency,
      payment_provider: order.payment_provider,
      created_at: order.created_at,
    })),
  });
});
