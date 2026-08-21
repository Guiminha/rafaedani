import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://oycdogwnvvjonlxhgucr.supabase.co", "sb_publishable_Fs1cWkU1y6S7icq4H-nLMQ_6Pl3axiY");
supabase.from("fotos").delete().eq("id", "rafae-dani-cover-id-001").then(() => console.log("Deleted DB")).catch(console.error);
