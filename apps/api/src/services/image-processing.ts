import sharp from 'sharp';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {AppError} from '../middleware/errors';
export const isPhoto=(filename:string)=>/\.(jpe?g|png|webp|heic|heif)$/i.test(filename);
export async function previewPhoto(root:string,key:string){
 try{
  const original=path.join(root,'primary',key),source=sharp(original,{limitInputPixels:100000000}),meta=await source.metadata();
  if(!meta.width||!meta.height)throw new Error('Missing dimensions');
  const resized=await source.rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).toBuffer({resolveWithObject:true});
  const width=resized.info.width,height=resized.info.height,font=Math.max(12,Math.min(36,Math.floor(width/20)));
  const watermark=Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect y="${Math.max(0,height-font*2)}" width="${width}" height="${font*2}" fill="#111" fill-opacity=".55"/><text x="50%" y="${height-font/2}" text-anchor="middle" font-family="sans-serif" font-size="${font}" fill="white">KAMRAW · PREVIEW</text></svg>`);
  await mkdir(path.join(root,'preview'),{recursive:true});await sharp(resized.data).composite([{input:watermark}]).jpeg({quality:82}).toFile(path.join(root,'preview',`${key}.jpg`));
  return {width:meta.autoOrient?.width??meta.width,height:meta.autoOrient?.height??meta.height};
 }catch{throw new AppError(422,'INVALID_IMAGE','This edited image cannot be decoded. Export a valid JPEG, PNG or WebP and upload it again.');}
}
