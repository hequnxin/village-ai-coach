const TLSSigAPIv2 = require('tls-sig-api-v2');

const SDKAppID = 1600137866;
const SECRETKEY = 'c34d3abca286cf6dac38b683d0981613594a6c1156153d6d025f80d0e0e0cafd';

function genUserSig(userId, expire = 86400) {
  const api = new TLSSigAPIv2.Api(SDKAppID, SECRETKEY);
  return api.genSig(userId, expire);
}

module.exports = { genUserSig, SDKAppID };