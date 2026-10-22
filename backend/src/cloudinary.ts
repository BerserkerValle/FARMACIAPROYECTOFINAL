import { v2 as cloudinary } from 'cloudinary';

const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

export const cloudinaryEnabled = Boolean(cloudName && apiKey && apiSecret);

if (cloudinaryEnabled) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
}

export function uploadProductImageToCloudinary(buffer: Buffer, originalName: string) {
  return new Promise<{ url: string; filename: string }>((resolve, reject) => {
    const extension = originalName.split('.').pop()?.toLowerCase() || 'image';
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'derkas-farmacia/products',
        resource_type: 'image',
        format: extension === 'jpg' ? 'jpg' : undefined
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error ?? new Error('Cloudinary no devolvió una URL de imagen'));
          return;
        }
        resolve({ url: result.secure_url, filename: result.public_id });
      }
    );
    stream.end(buffer);
  });
}
