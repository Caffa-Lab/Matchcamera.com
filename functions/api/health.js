export async function onRequestGet(){return Response.json({ok:true,service:"matchcamera",time:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}})}
