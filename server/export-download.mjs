import { fail } from '../src/engine.mjs';
import { readBody } from './read-body.mjs';
export async function readExportForm(req) {
 if (req.method !== 'POST') fail('Method not allowed.',405);
 if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) fail('Use an export form.',415);
 const raw = await readBody(req);
 const form=new URLSearchParams(String(raw)), token=form.get('token'), id=form.get('session');
 if(!token || token.length>10000) fail('Sign in to continue.',401);
 if(!/^[a-zA-Z0-9-]{1,100}$/.test(id || '')) fail('Session not found.',404);
 return {token,id};
}
export function sendExport(res,id,data) {
 const body=JSON.stringify(data,null,2);
 res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="session-'+id+'.json"','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 res.end(body);
}
