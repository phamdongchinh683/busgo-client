export const imageUploadPresets = {
  chat: {
    maxBytes: 12 * 1024 * 1024,
    minResizeBytes: 500 * 1024,
    maxDimension: 1600,
    qualityPng: 0.9,
    qualityWebp: 0.8,
    qualityJpeg: 0.85,
    parallelBatch: 4,
  },
  companyLogo: {
    maxBytes: 8 * 1024 * 1024,
    minResizeBytes: 280 * 1024,
    maxDimension: 420,
    qualityWebp: 0.74,
    qualityJpeg: 0.78,
  },
  promotion: {
    maxBytes: 10 * 1024 * 1024,
    minResizeBytes: 280 * 1024,
    maxDimension: 720,
    qualityWebp: 0.74,
    qualityJpeg: 0.8,
  },
} as const;
