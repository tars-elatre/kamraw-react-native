import {Platform,Linking} from 'react-native';
import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function savePdf(filename:string,base64:string){
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  if(Platform.OS==='web'){
    const url=URL.createObjectURL(new Blob([bytes.buffer],{type:'application/pdf'})),link=document.createElement('a');
    link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }else{
    const file=new File(Paths.cache,filename);file.create({overwrite:true});file.write(bytes);
    if(!await Sharing.isAvailableAsync())throw new Error('File sharing is unavailable on this device.');
    await Sharing.shareAsync(file.uri,{mimeType:'application/pdf'});
  }
}

export async function downloadArchive(url:string,filename:string){
  if(Platform.OS==='web'){await Linking.openURL(url);return;}
  const file=await File.downloadFileAsync(url,new File(Paths.cache,filename),{idempotent:true});
  if(!await Sharing.isAvailableAsync())throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(file.uri,{mimeType:'application/zip'});
}
