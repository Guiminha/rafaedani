import React, { useState, useEffect } from "react";
import { Camera, Trash2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

type AdminFoto = {
  id: string;
  url_original: string;
  url_thumbnail: string;
  data_upload: string;
};

// Canvas resizer helper
const resizeImageForCover = (file: File): Promise<Blob> => {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1920;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          resolve(blob || file);
        }, "image/webp", 0.85);
      } else {
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
};

export default function Admin() {
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [photos, setPhotos] = useState<AdminFoto[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Cover upload state
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverStatus, setCoverStatus] = useState<"idle" | "success" | "error">("idle");
  const [coverErrorMessage, setCoverErrorMessage] = useState("");

  const [loginError, setLoginError] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "admin123") {
      setIsAuthenticated(true);
      fetchPhotos();
      setLoginError("");
    } else {
      setLoginError("Senha incorreta");
    }
  };

  const fetchPhotos = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/photos");
      if (res.ok) {
        const data = await res.json();
        setPhotos(data);
      }
    } catch (err) {
      console.error("Error fetching photos", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCoverUploading(true);
    setCoverStatus("idle");
    setCoverErrorMessage("");

    try {
      const blob = await resizeImageForCover(file);
      const formData = new FormData();
      formData.append("file", blob, file.name);

      const res = await fetch("/api/admin/set-cover", {
        method: "POST",
        headers: {
          "x-admin-password": password
        },
        body: formData,
      });

      if (res.ok) {
        setCoverStatus("success");
        fetchPhotos();
        setTimeout(() => setCoverStatus("idle"), 3000);
      } else {
        const errData = await res.json();
        setCoverStatus("error");
        setCoverErrorMessage(errData.error || "Erro ao alterar capa");
      }
    } catch (err: any) {
      setCoverStatus("error");
      setCoverErrorMessage(err.message || "Erro de conexão");
    } finally {
      setCoverUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    // window.confirm é bloqueado em iframes (como o AI Studio), então removemos a confirmação 
    // ou fazemos ela de forma customizada. Por enquanto, será exclusão direta para garantir a usabilidade.
    try {
      const res = await fetch(`/api/admin/photos/${id}`, {
        method: "DELETE",
        headers: {
          "x-admin-password": password
        }
      });

      if (res.ok) {
        setPhotos(photos.filter(p => p.id !== id));
      } else {
        const errData = await res.json();
        console.error(`Erro ao apagar: ${errData.error}`);
      }
    } catch (err: any) {
      console.error(`Erro: ${err.message}`);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-neutral-800 p-8 rounded-2xl shadow-xl w-full max-w-sm">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">Área Administrativa</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-neutral-400 text-sm mb-2">Senha</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-[#3CA0CC]"
                placeholder="••••••••"
              />
            </div>
            {loginError && <p className="text-red-500 text-sm text-center">{loginError}</p>}
            <button 
              type="submit"
              className="w-full bg-[#3CA0CC] hover:bg-[#348db4] text-white font-bold py-3 rounded-xl transition-colors"
            >
              Entrar
            </button>
          </div>
        </form>
      </div>
    );
  }

  const coverPhoto = photos.find(p => p.url_original.includes("RafaeDani.webp"));
  const galleryPhotos = photos.filter(p => !p.url_original.includes("RafaeDani.webp"));

  return (
    <div className="min-h-screen bg-neutral-900 text-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-12">
        <header className="flex justify-between items-center border-b border-neutral-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold">Painel de Controle</h1>
            <p className="text-neutral-400 mt-1">Gerencie as fotos do casamento</p>
          </div>
          <button 
            onClick={() => {
              setIsAuthenticated(false);
              setPassword("");
            }}
            className="text-neutral-400 hover:text-white"
          >
            Sair
          </button>
        </header>

        {/* Capa Section */}
        <section className="bg-neutral-800 rounded-3xl p-6 sm:p-8 border border-neutral-700">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Camera className="w-6 h-6 text-[#3CA0CC]" />
            Alterar Foto de Capa
          </h2>
          
          <div className="flex flex-col sm:flex-row gap-8 items-start">
            <div className="w-full sm:w-1/2 aspect-video bg-neutral-900 rounded-2xl overflow-hidden relative border border-neutral-700">
              {coverPhoto ? (
                <img src={coverPhoto.url_original} alt="Capa atual" className="w-full h-full object-cover object-top" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-600">Sem capa</div>
              )}
            </div>

            <div className="w-full sm:w-1/2 space-y-4">
              <label className="block w-full bg-neutral-900 border-2 border-dashed border-neutral-700 hover:border-[#3CA0CC] hover:bg-[#3CA0CC]/5 rounded-2xl p-8 text-center cursor-pointer transition-colors group">
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleCoverUpload}
                  disabled={coverUploading}
                />
                {coverUploading ? (
                  <div className="flex flex-col items-center justify-center text-[#3CA0CC]">
                    <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                    <span className="font-medium">Enviando nova capa...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-neutral-400 group-hover:text-[#3CA0CC]">
                    <Camera className="w-8 h-8 mb-2" />
                    <span className="font-medium">Toque para selecionar nova capa</span>
                  </div>
                )}
              </label>

              {coverStatus === "success" && (
                <div className="p-3 bg-green-900/30 border border-green-800 text-green-400 rounded-xl flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  Capa alterada com sucesso!
                </div>
              )}

              {coverStatus === "error" && (
                <div className="p-3 bg-red-900/30 border border-red-800 text-red-400 rounded-xl flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="w-5 h-5" />
                    Erro ao alterar capa
                  </div>
                  <span className="text-xs opacity-80">{coverErrorMessage}</span>
                </div>
              )}
              
              <p className="text-xs text-neutral-500">
                A imagem será automaticamente otimizada e substituirá a capa atual em toda a aplicação.
              </p>
            </div>
          </div>
        </section>

        {/* Galeria Section */}
        <section>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Fotos Enviadas ({galleryPhotos.length})</h2>
            <button onClick={fetchPhotos} className="text-sm text-[#3CA0CC] hover:text-white flex items-center gap-2 bg-neutral-800 px-3 py-1.5 rounded-lg">
              <RefreshCw className="w-4 h-4" /> Atualizar
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <RefreshCw className="w-8 h-8 text-neutral-500 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {galleryPhotos.map((foto) => (
                <div key={foto.id} className="group relative aspect-square bg-neutral-800 rounded-xl overflow-hidden border border-neutral-700">
                  {foto.url_original.match(/\.(mp4|mov|webm)$/i) ? (
                    <>
                      <video 
                        src={foto.url_thumbnail} 
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 pointer-events-none"
                        muted
                        playsInline
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                        <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm shadow-xl">
                          <div className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-white ml-1"></div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <img 
                      src={foto.url_thumbnail} 
                      alt="Galeria" 
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 z-10">
                    <button 
                      onClick={() => handleDelete(foto.id)}
                      className="w-full bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm font-medium shadow-lg"
                    >
                      <Trash2 className="w-4 h-4" /> Apagar
                    </button>
                  </div>
                </div>
              ))}
              
              {galleryPhotos.length === 0 && (
                <div className="col-span-full py-12 text-center text-neutral-500 bg-neutral-800/50 rounded-2xl border border-neutral-800 border-dashed">
                  Nenhuma foto enviada pelos convidados ainda.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
