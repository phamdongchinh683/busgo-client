import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { constant } from '../../constants';
import { UploadPresignedResponse } from '../../interfaces/upload';

export { imageUploadPresets } from './image-upload-presets';

type PrepareUploadOptions = {
  maxBytes?: number;
  minResizeBytes?: number;
  maxDimension?: number;
  preferredOutputType?: string;
  quality?: number;
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  getPresigned(folder: string, id: number): Observable<UploadPresignedResponse> {
    return this.http.get<UploadPresignedResponse>(`${constant.baseUrl}/file/upload/super-admin/presigned`, {
      params: { folder, id: String(id) },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  }

  getChatBoxPresigned(boxId: number): Observable<UploadPresignedResponse> {
    return this.getPresigned('chat', boxId);
  }

  uploadImageToCloudinary(file: File, config: UploadPresignedResponse): Promise<string> {
    return this.uploadImageToCloudinaryWithProgress(file, config);
  }

  uploadImageToCloudinaryWithProgress(
    file: File,
    config: UploadPresignedResponse,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    const run = () => this.uploadOnceByXhr(file, config, onProgress);
    return run().catch(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return await run();
    });
  }

  async prepareImageForUpload(
    file: File,
    config: UploadPresignedResponse,
    options?: PrepareUploadOptions,
  ): Promise<File> {
    if (!file.type.startsWith('image/')) {
      throw new Error('Chỉ hỗ trợ tệp ảnh.');
    }

    const maxBytes = options?.maxBytes ?? 12 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`Ảnh vượt quá giới hạn ${Math.round(maxBytes / (1024 * 1024))}MB.`);
    }

    const accepted = config.acceptedMimeTypes ?? [];
    const fallbackType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const preferred = options?.preferredOutputType ?? fallbackType;
    const outputType = this.pickAllowedOutputType(preferred, file.type, accepted);

    const minResizeBytes = options?.minResizeBytes ?? 400 * 1024;
    const uploadFile = await this.resizeImageFile(file, {
      maxDimension: options?.maxDimension ?? 1024,
      outputType,
      quality: options?.quality ?? 0.84,
      minBytesForLossyReencode: minResizeBytes,
    });

    if (accepted.length && !accepted.includes(uploadFile.type)) {
      throw new Error('Định dạng ảnh không được hỗ trợ.');
    }
    return uploadFile;
  }

  async resizeImageFile(
    file: File,
    options?: {
      maxDimension?: number;
      outputType?: string;
      quality?: number;
      minBytesForLossyReencode?: number;
    },
  ): Promise<File> {
    const maxDimension = options?.maxDimension ?? 512;
    const outputType = options?.outputType ?? 'image/jpeg';
    const quality = options?.quality ?? 0.85;
    const minBytesForLossyReencode = options?.minBytesForLossyReencode ?? 600 * 1024;

    if (!file.type.startsWith('image/')) return file;

    const probe = await this.loadImageSource(file);
    const width = probe.width;
    const height = probe.height;
    if (!width || !height) {
      probe.close?.();
      return file;
    }

    const needsDownscale = width > maxDimension || height > maxDimension;
    const mayReencodeLossy =
      outputType !== 'image/png' && file.size >= minBytesForLossyReencode;
    if (!needsDownscale && !mayReencodeLossy) {
      probe.close?.();
      return file;
    }

    const scale = Math.min(maxDimension / width, maxDimension / height, 1);
    const nextWidth = Math.max(1, Math.round(width * scale));
    const nextHeight = Math.max(1, Math.round(height * scale));
    const shouldResize = nextWidth < width || nextHeight < height;

    probe.close?.();

    if (shouldResize) {
      const fast = await this.tryEncodeResizedWithBitmapResize(
        file,
        nextWidth,
        nextHeight,
        outputType,
        quality,
      );
      if (fast && fast.size < file.size) return fast;
      const fallback = await this.encodeViaCanvasScale(file, nextWidth, nextHeight, outputType, quality);
      if (fallback && fallback.size < file.size) return fallback;
      return file;
    }

    if (mayReencodeLossy) {
      const encoded = await this.encodeViaCanvasFull(file, width, height, outputType, quality);
      if (encoded && encoded.size < file.size) return encoded;
    }

    return file;
  }

  /** Resize trong một bước decode (nhanh hơn decode full + vẽ scale trên canvas). */
  private async tryEncodeResizedWithBitmapResize(
    file: File,
    nextWidth: number,
    nextHeight: number,
    outputType: string,
    quality: number,
  ): Promise<File | null> {
    if (typeof createImageBitmap !== 'function') return null;
    try {
      const resized = await createImageBitmap(file, {
        resizeWidth: nextWidth,
        resizeHeight: nextHeight,
        resizeQuality: 'medium',
      });
      const blob = await this.imageSourceToBlob(resized, nextWidth, nextHeight, outputType, quality);
      resized.close();
      if (!blob) return null;
      return this.blobToOutputFile(blob, file.name, outputType);
    } catch {
      return null;
    }
  }

  private async encodeViaCanvasScale(
    file: File,
    nextWidth: number,
    nextHeight: number,
    outputType: string,
    quality: number,
  ): Promise<File | null> {
    const image = await this.loadImageSource(file);
    if (!image.width || !image.height) {
      image.close?.();
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      image.close?.();
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    try {
      ctx.drawImage(image.source, 0, 0, nextWidth, nextHeight);
    } finally {
      image.close?.();
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), outputType, quality),
    );
    if (!blob) return null;
    return this.blobToOutputFile(blob, file.name, outputType);
  }

  private async encodeViaCanvasFull(
    file: File,
    width: number,
    height: number,
    outputType: string,
    quality: number,
  ): Promise<File | null> {
    const image = await this.loadImageSource(file);
    if (!image.width || !image.height) {
      image.close?.();
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      image.close?.();
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    try {
      ctx.drawImage(image.source, 0, 0);
    } finally {
      image.close?.();
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), outputType, quality),
    );
    if (!blob) return null;
    return this.blobToOutputFile(blob, file.name, outputType);
  }

  private async imageSourceToBlob(
    source: CanvasImageSource,
    w: number,
    h: number,
    outputType: string,
    quality: number,
  ): Promise<Blob | null> {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), outputType, quality),
    );
  }

  private blobToOutputFile(blob: Blob, originalName: string, outputType: string): File {
    const newExt = outputType === 'image/png' ? 'png' : outputType === 'image/webp' ? 'webp' : 'jpg';
    const baseName = originalName.replace(/\.[^/.]+$/, '');
    return new File([blob], `${baseName}.${newExt}`, { type: outputType });
  }

  private async loadImageSource(
    file: File,
  ): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    }

    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ source: img, width: 0, height: 0 });
      };
      img.src = url;
    });
  }

  private pickAllowedOutputType(preferred: string, sourceType: string, accepted: string[]): string {
    if (!accepted.length) return preferred;
    if (accepted.includes(preferred)) return preferred;
    if (accepted.includes(sourceType)) return sourceType;
    const candidates = ['image/webp', 'image/jpeg', 'image/png'];
    for (const type of candidates) {
      if (accepted.includes(type)) return type;
    }
    return preferred;
  }

  private uploadOnceByXhr(
    file: File,
    config: UploadPresignedResponse,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`;
      xhr.open('POST', url, true);
      xhr.timeout = 120000;

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !onProgress) return;
        const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        onProgress(percent);
      };

      xhr.onerror = () => reject(new Error('Tải tệp thất bại.'));
      xhr.ontimeout = () => reject(new Error('Tải tệp quá thời gian cho phép.'));
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== XMLHttpRequest.DONE) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as { secure_url?: string };
            if (!data.secure_url) {
              reject(new Error('Không nhận được URL ảnh sau khi tải lên.'));
              return;
            }
            onProgress?.(100);
            resolve(data.secure_url);
          } catch {
            reject(new Error('Không đọc được phản hồi tải ảnh.'));
          }
          return;
        }
        try {
          const body = JSON.parse(xhr.responseText) as { error?: { message?: string } };
          reject(new Error(body.error?.message ?? `Tải tệp thất bại (${xhr.status})`));
        } catch {
          reject(new Error(`Tải tệp thất bại (${xhr.status})`));
        }
      };

      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', config.apiKey);
      formData.append('timestamp', String(config.timestamp));
      formData.append('signature', config.signature);
      formData.append('folder', config.folder);
      xhr.send(formData);
    });
  }
}
