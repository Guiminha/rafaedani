/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Camera, X, Upload, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import imageCompression from "browser-image-compression";

interface Foto {
  id: string;
  url_original: string;
  url_thumbnail: string;
  data_upload: string;
}

const getDeviceId = () => {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem("deviceId", id);
  }
  return id;
};

export default function App() {
  const [photos, setPhotos] = useState<Foto[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchPhotos();
  }, []);

  const fetchPhotos = async () => {
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      if (files.length > 5) {
        alert("Você pode selecionar no máximo 5 arquivos por vez.");
        setSelectedFiles(files.slice(0, 5));
      } else {
        setSelectedFiles(files);
      }
      setUploadStatus("idle");
      setOverallProgress(0);
    }
  };

  const uploadVideoWithProgress = async (file: File, deviceId: string): Promise<Foto> => {
    const res = await fetch("/api/video/presigned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type, deviceId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to get upload URL");
    
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", data.uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(true);
        else reject(new Error("Video upload failed with status " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("Network error during video upload"));
      xhr.send(file);
    });
    
    const finalizeRes = await fetch("/api/video/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: data.id, key: data.key, deviceId })
    });
    const finalizeData = await finalizeRes.json();
    if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to finalize video");
    
    return finalizeData.foto;
  };

  const uploadFileWithProgress = (file: File, deviceId: string): Promise<Foto> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.setRequestHeader("x-device-id", deviceId);
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            if (res.error) {
              reject(new Error(res.error));
            } else {
              resolve(res.foto);
            }
          } catch (err) {
            reject(new Error("Invalid response format"));
          }
        } else {
          try {
            const res = JSON.parse(xhr.responseText);
            reject(new Error(res.error || "Upload failed with status " + xhr.status));
          } catch {
            reject(new Error("Upload failed with status " + xhr.status));
          }
        }
      };
      
      xhr.onerror = () => reject(new Error("Network error"));
      
      const formData = new FormData();
      formData.append("file", file);
      xhr.send(formData);
    });
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    setUploading(true);
    setUploadStatus("idle");
    setOverallProgress(0);
    setErrorMessage("");
    
    const newPhotos: Foto[] = [];
    const deviceId = getDeviceId();
    
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        
        if (file.type.startsWith("video/")) {
          if (file.size > 100 * 1024 * 1024) {
            throw new Error(`O vídeo ${file.name} ultrapassa o limite de 100MB.`);
          }
          const foto = await uploadVideoWithProgress(file, deviceId);
          newPhotos.push(foto);
        } else if (file.type.startsWith("image/")) {
          let fileToUpload = file;
          try {
            // Client-side compression to prevent server 503 OOM crashes
            const options = {
              maxSizeMB: 3,
              maxWidthOrHeight: 1920,
              useWebWorker: true,
              fileType: "image/webp"
            };
            fileToUpload = await imageCompression(file, options);
          } catch (compressErr) {
            console.warn("Client compression failed, sending original", compressErr);
            if (file.size > 5 * 1024 * 1024) {
              throw new Error(`Não foi possível otimizar a imagem ${file.name} no seu aparelho. Tente outra foto.`);
            }
          }
          const foto = await uploadFileWithProgress(fileToUpload, deviceId);
          newPhotos.push(foto);
        } else {
          throw new Error("Formato de arquivo não suportado.");
        }
        
        setOverallProgress(Math.round(((i + 1) / selectedFiles.length) * 100));
      }

      setUploadStatus("success");
      setSelectedFiles([]);
      // Add new photos to the beginning of the list
      setPhotos((prev) => [...newPhotos.reverse(), ...prev]);
      
      // Fechar o modal imediatamente após o envio terminar com sucesso
      setIsModalOpen(false);
    } catch (err: any) {
      console.error("Upload failed", err);
      setUploadStatus("error");
      setErrorMessage(err.message || "Erro desconhecido");
    } finally {
      setUploading(false);
    }
  };

  const coverPhoto = photos.find(p => p.url_original.includes("RafaeDani.webp"));
  const coverImageUrl = coverPhoto ? coverPhoto.url_original : "https://s3.danierafa.online/rafa-dani/RafaeDani.webp";
  const galleryPhotos = photos.filter(p => !p.url_original.includes("RafaeDani.webp"));

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);
  
  const showPrevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lightboxIndex !== null) {
      setLightboxIndex(lightboxIndex === 0 ? galleryPhotos.length - 1 : lightboxIndex - 1);
    }
  };

  const showNextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lightboxIndex !== null) {
      setLightboxIndex(lightboxIndex === galleryPhotos.length - 1 ? 0 : lightboxIndex + 1);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-900 font-sans text-neutral-100 relative overflow-x-hidden">
      {/* Background Gradient */}
      <div className="fixed bottom-0 right-0 w-[60vw] h-[50vh] bg-gradient-to-tl from-[#3CA0CC]/10 via-[#3CA0CC]/5 to-transparent blur-[80px] pointer-events-none z-0"></div>

      {/* Header (Capa) */}
      <header className="relative h-64 sm:h-80 w-full bg-neutral-800 shrink-0">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10"></div>
        <img 
          src={coverImageUrl} 
          alt="Capa do Casamento" 
          className="absolute inset-0 w-full h-full object-cover object-top z-0"
        />
        <div className="absolute inset-0 z-20 flex items-end justify-center text-white drop-shadow-lg pb-6 sm:pb-8">
          <div className="flex flex-col items-center">
            <h1 
              className="text-5xl sm:text-7xl md:text-8xl font-normal text-center drop-shadow-xl"
              style={{ fontFamily: "'Great Vibes', cursive" }}
            >
              Danielle
              <span className="inline-block mx-2 sm:mx-4 md:mx-6 text-[#3CA0CC] font-normal text-4xl sm:text-6xl md:text-7xl">&amp;</span>
              Rafael
            </h1>
            <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-[#3CA0CC] to-transparent mt-2 mb-2"></div>
            <p className="text-xs sm:text-sm font-medium tracking-[0.3em] uppercase opacity-90 mt-1">06 • 09 • 2026</p>
          </div>
        </div>
      </header>

      {/* Seção de Título */}
      <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full relative z-10">
        <section className="px-6 py-8 shrink-0 text-center">
          <h2 className="text-xl sm:text-2xl font-light text-white leading-tight">
            Compartilhe seus momentos<br />com a gente!
          </h2>
        </section>

        {/* Galeria de Fotos */}
        <section className="px-4 flex-1 pb-24">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#3CA0CC]"></div>
          </div>
        ) : galleryPhotos.length === 0 ? (
          <div className="text-center py-20 bg-neutral-900/50 rounded-xl border border-neutral-800 backdrop-blur-sm">
            <Camera className="w-12 h-12 text-neutral-600 mx-auto mb-3" />
            <p className="text-neutral-400 text-sm">Nenhuma foto ainda. Seja o primeiro a compartilhar!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 content-start h-full">
            {galleryPhotos.map((foto, index) => (
              <div 
                key={foto.id} 
                className="aspect-square relative overflow-hidden bg-neutral-800 cursor-pointer group rounded-lg ring-1 ring-white/5"
                onClick={() => openLightbox(index)}
              >
                {foto.url_original.match(/\.(mp4|mov|webm)$/i) ? (
                  <>
                    <video 
                      src={foto.url_thumbnail} 
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 pointer-events-none"
                      muted
                      playsInline
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors duration-300">
                      <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm shadow-xl">
                        <div className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-white ml-1"></div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <img 
                      src={foto.url_thumbnail} 
                      alt="Momento do casamento" 
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        target.parentElement?.classList.add('flex', 'items-center', 'justify-center');
                        target.parentElement?.setAttribute('title', 'Imagem bloqueada pelo MinIO (Bucket não é público)');
                        
                        const errorIcon = document.createElement('div');
                        errorIcon.className = 'text-xs text-center text-neutral-500 p-2';
                        errorIcon.innerHTML = '🔒<br/>Privado';
                        target.parentElement?.appendChild(errorIcon);
                      }}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        </section>
      </main>

      {/* Footer / Barra Fixa */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-[#0a0a0a]/80 backdrop-blur-xl border-t border-white/5 flex items-center justify-center z-40">
        <div className="w-full max-w-md mx-auto">
          <button 
            onClick={() => {
              setIsModalOpen(true);
              setUploadStatus("idle");
              setSelectedFiles([]);
            }}
            className="w-full h-14 bg-[#3CA0CC] hover:bg-[#348db4] text-white font-bold rounded-2xl shadow-lg shadow-[#3CA0CC]/30 active:scale-95 transition-all text-lg flex items-center justify-center gap-2"
          >
            <Upload className="w-5 h-5" />
            Enviar Foto
          </button>
        </div>
      </footer>

      {/* Modal de Upload */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => !uploading && setIsModalOpen(false)}>
          <div 
            className="bg-neutral-900 border border-neutral-800 shadow-2xl rounded-2xl w-full max-w-md p-6 relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => !uploading && setIsModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors p-1"
            >
              <X className="w-6 h-6" />
            </button>
            
            <h3 className="text-xl font-semibold mb-6 text-white">Enviar nova foto</h3>
            
            <div className="mb-6">
              <label 
                htmlFor="file-upload"
                className="border-2 border-dashed border-neutral-700 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-[#3CA0CC] hover:bg-[#3CA0CC]/10 transition-colors group relative overflow-hidden"
              >
                {uploading && (
                  <div 
                    className="absolute bottom-0 left-0 h-1 bg-[#3CA0CC] transition-all duration-300 ease-out" 
                    style={{ width: `${overallProgress}%` }}
                  ></div>
                )}
                <Camera className="w-10 h-10 text-[#3CA0CC]/70 group-hover:text-[#3CA0CC] transition-colors mb-3" />
                <span className="text-sm text-neutral-400 text-center">
                  {selectedFiles.length > 0 
                    ? selectedFiles.length === 1 
                      ? selectedFiles[0].name 
                      : `${selectedFiles.length} fotos selecionadas`
                    : "Toque para escolher fotos"}
                </span>
                <input 
                  id="file-upload" 
                  type="file" 
                  accept="image/*,video/mp4,video/quicktime,video/webm" 
                  multiple
                  className="hidden" 
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>
              {uploading && (
                <div className="mt-2 text-center text-xs text-neutral-500">
                  Enviando... {overallProgress}%
                </div>
              )}
            </div>

            {uploadStatus === "success" && (
              <div className="mb-6 p-3 bg-green-900/30 border border-green-800 text-green-400 rounded-lg flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-5 h-5" />
                Enviado com sucesso!
              </div>
            )}
            
            {uploadStatus === "error" && (
              <div className="mb-6 p-3 bg-red-900/30 border border-red-800 text-red-400 rounded-lg flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Erro ao enviar. Tente novamente.
                </div>
                {errorMessage && (
                  <div className="text-xs text-red-300 opacity-80 mt-1 break-words">
                    Detalhes: {errorMessage}
                  </div>
                )}
              </div>
            )}

            <button 
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploading || uploadStatus === "success"}
              className="w-full bg-white text-black hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500 font-semibold py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {uploading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Enviando ({overallProgress}%)
                </>
              ) : uploadStatus === "success" ? (
                "Enviado"
              ) : (
                "Confirmar Envio"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Lightbox Visualizador */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center" onClick={closeLightbox}>
          {/* Close button */}
          <button 
            onClick={closeLightbox}
            className="absolute top-6 right-6 text-white/70 hover:text-white p-2 z-[70] bg-black/20 rounded-full"
          >
            <X className="w-8 h-8" />
          </button>
          
          {/* Prev button */}
          <button 
            onClick={showPrevPhoto}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-3 z-[70] bg-black/20 hover:bg-black/40 rounded-full transition-all"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
          
          {/* Next button */}
          <button 
            onClick={showNextPhoto}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-3 z-[70] bg-black/20 hover:bg-black/40 rounded-full transition-all"
          >
            <ChevronRight className="w-8 h-8" />
          </button>

          {photos[lightboxIndex].url_original.match(/\.(mp4|mov|webm)$/i) ? (
            <video 
              src={photos[lightboxIndex].url_original} 
              controls
              autoPlay
              className="max-w-full max-h-[90vh] object-contain select-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img 
              src={photos[lightboxIndex].url_original} 
              alt="Original" 
              className="max-w-full max-h-[90vh] object-contain select-none"
              onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.error-msg')) {
                  const errorMsg = document.createElement('div');
                  errorMsg.className = 'error-msg text-white text-center p-8 bg-neutral-900 rounded-lg';
                  errorMsg.innerHTML = '<h3>🔒 Imagem Bloqueada</h3><p class="text-neutral-400 mt-2">O bucket do seu MinIO não permite leitura pública.</p>';
                  parent.appendChild(errorMsg);
                }
              }}
            />
          )}
          
          {/* Counter */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-sm font-medium tracking-wide">
            {lightboxIndex + 1} / {photos.length}
          </div>
        </div>
      )}
    </div>
  );
}

