// db.js - Conexão e teste direto com o Supabase para a Hostinger
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("⚠️ [Supabase db.js] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não foram definidos nas variáveis de ambiente!");
}

const supabase = createClient(supabaseUrl || "", supabaseKey || "", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Função de verificação do banco de dados (tabela 'photos')
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from("photos")
      .select("id, created_at, photo_url")
      .limit(5);

    if (error) {
      console.error("❌ Erro ao conectar na tabela 'photos':", error.message);
      return { success: false, error: error.message };
    }

    console.log("✅ Conexão com Supabase bem-sucedida! Fotos encontradas:", data?.length || 0);
    return { success: true, count: data?.length || 0, data };
  } catch (err) {
    console.error("❌ Falha inesperada no db.js:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { supabase, testConnection };
