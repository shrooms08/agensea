import { canonicalize, manifestHash, type DeliverableManifest } from '../erc8183/manifest.ts';
const m: DeliverableManifest = {
  version: 1, job_id: 42, chain_id: 97,
  contracts: { commerce: '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de', router: '0xd7d36d66d2f1b608a0f943f722d27e3744f66f25', policy: '0xd6a4217588f6b1f5657a92a3e94e6422ad771cea' },
  response: { content: 'health factor 1.9008, risk HEALTHY', content_type: 'application/json' },
  metadata: { agent: 'health-factor-monitor', zzz: 1, aaa: [3, 2, 1], nested: { b: 2, a: 1 } },
};
console.log('CANON:' + canonicalize(m));
console.log('HASH:' + manifestHash(m));
