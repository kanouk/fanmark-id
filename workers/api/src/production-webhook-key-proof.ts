import {WorkerEntrypoint} from "cloudflare:workers";
import type {Env} from "./repository";
import {PRODUCTION_RUNTIME} from "./production-runtime-identity";

type Challenge = {provider:"stripe"|"resend"; nonce:string; runtimeVersion:string};
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const bindings={stripe:"STRIPE_WEBHOOK_SECRET",resend:"BROADCAST_WEBHOOK_SIGNING_SECRET"} as const;
/** Binding-only proof of the actual secret value. No secret/escrow export and
 * no datastore or outbound request. Domain separation prevents this capability
 * being used to sign a Stripe or Svix event. Never add a public HTTP route. */
export class ProductionWebhookKeyProofService extends WorkerEntrypoint<Env> {
  async prove(input:Challenge){
    if(!input||Object.keys(input).sort().join(",")!=="nonce,provider,runtimeVersion"||
      !Object.hasOwn(bindings,input.provider)||!UUID.test(input.nonce??"")||!UUID.test(input.runtimeVersion??"")||
      this.env.CF_VERSION_METADATA?.id!==input.runtimeVersion||this.env.CUTOVER_WRITE_FREEZE!=="receipt_only"||
      this.env.BETTER_AUTH_URL!=="https://fanmark.id"||this.env.RECOVERY_DRAIN_SCOPE_DIGEST!==PRODUCTION_RUNTIME.scope)
      throw Error("production_webhook_key_proof_refused");
    const binding=bindings[input.provider],secret=this.env[binding];
    if(typeof secret!=="string"||!/^whsec_[A-Za-z0-9+/=_-]{16,240}$/u.test(secret))throw Error("production_webhook_key_proof_refused");
    let bytes:Uint8Array;
    try{bytes=input.provider==="stripe"?new TextEncoder().encode(secret):Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0));}
    catch{throw Error("production_webhook_key_proof_refused");}
    if(bytes.length<16){bytes.fill(0);throw Error("production_webhook_key_proof_refused");}
    try{
      const key=await crypto.subtle.importKey("raw",bytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
      const message=`fanmark-production-webhook-key-proof-v1\n${input.provider}\n${input.runtimeVersion}\n${input.nonce}`;
      const mac=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));
      return {format:"fanmark-production-webhook-key-proof-v1",provider:input.provider,binding,
        runtimeVersion:input.runtimeVersion,nonce:input.nonce,proofHex:[...new Uint8Array(mac)].map(b=>b.toString(16).padStart(2,"0")).join("")};
    }finally{bytes.fill(0);}
  }
}
