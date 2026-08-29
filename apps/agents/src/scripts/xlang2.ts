import { canonicalize, manifestHash } from '../erc8183/manifest.ts';
const m = { version:1, job_id:757, chain_id:97,
  contracts:{commerce:'0xa2',router:'0xd7',policy:'0xd6'},
  response:{content:'OUT OF RANGE — price is below the band; naïve café 日本語 🎯', content_type:'application/json'},
  metadata:{agent:'test', nested:{b:2,a:1}, arr:[3,'—',1]} };
console.log('CANON:'+canonicalize(m));
console.log('HASH:'+manifestHash(m as any));
