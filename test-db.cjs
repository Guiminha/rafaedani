const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl && supabaseKey) {
  const supabase = createClient(supabaseUrl, supabaseKey);
  supabase.from('fotos').select('*').limit(1).then(({ data, error }) => {
    console.log("Data:", data);
    console.log("Error:", error);
  });
} else {
  console.log("No credentials");
}
