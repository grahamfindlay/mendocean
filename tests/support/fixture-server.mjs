import { createServer } from 'node:http';
export function startFixtures(secret, port = 54328) {
  let state = { bhc: [], lineup: false, failure: null, deliveries: [], attempts: [], calls: [] };
  const server = createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
    if (req.headers['x-fixture-secret'] !== secret) return reply(401, {});
    let input = ''; for await (const b of req) input += b;
    const data = input ? JSON.parse(input) : {};
    if (req.url === '/control') { state = {...state, ...data}; return reply(200, {}); }
    if (req.url === '/state') return reply(200, state);
    if (req.url === '/push' || req.url === '/upstream') {
      const url = data.url ? new URL(data.url) : null;
      const channel = req.url === '/push' ? 'push' : url.hostname === 'api.resend.com' ? 'email' : null;
      if (channel) {
        const payload = channel === 'push' ? JSON.parse(data.payload) : JSON.parse(data.body);
        const key = channel === 'email' ? data.headers['Idempotency-Key'] : payload.tag;
        const target = channel === 'email' ? payload.to[0] : data.subscription.endpoint;
        state.attempts.push({channel, key, target});
        if (state.failure === 'expired' && channel === 'push') return reply(410, {});
        if (state.failure === 'delivery') return reply(503, {});
        // Simulate provider email idempotency, not a guarantee of push exactly-once delivery.
        if (channel !== 'email' || !state.deliveries.some(d => d.key === key)) state.deliveries.push({channel,key,target,payload});
        if (state.failure === 'after_accept') { state.failure = null; return reply(503, {}); }
        return reply(200, {id:'synthetic-delivery'});
      }
      state.calls.push({host:url.hostname,path:url.pathname}); // Never retain token-bearing URLs.
      if (url.hostname === 'api.boathouseconnect.com') {
        if (state.failure === 'bhc' || url.searchParams.get('token')?.startsWith('invalid')) return reply(401, {});
        if (state.failure === 'malformed') return reply(200, {unexpected:true});
        if (url.pathname === '/authenticate/checkApiKey') return reply(200, {custid:101});
        if (url.pathname === '/users/getAllWhitelabels') return reply(200, [{whitelabel_id:1}]);
        if (url.pathname === '/equipment/getAllBoats') return reply(200, [{boat_id:7,boat_type:2,rigging:'sculling'}]);
        if (url.pathname === '/practices/getAthletePractices') return reply(200, url.searchParams.get('upcoming') === 'true' ? state.bhc : []);
        if (url.pathname === '/practices/getPractices') return reply(200, [{attendance:[{custid:101,lineup_boat:state.lineup?7:null,lineup_seat:'2'}],assigned_coaches:[{custid:90,fname:'Charlie'}]}]);
        return reply(500, {error:'Unexpected BHC path'});
      }
      if (['api.open-meteo.com','historical-forecast-api.open-meteo.com'].includes(url.hostname)) {
        if (state.failure === 'weather') return reply(503, {});
        if (state.failure === 'weather_malformed') return reply(200, {});
        const base = Math.floor(Date.now()/3600000)*3600 - 86400;
        const defaults = {wind_speed_10m:7,wind_direction_10m:180,wind_gusts_10m:10,temperature_2m:65,precipitation:0,precipitation_probability:0,visibility:16000,weather_code:0};
        const time = Array.from({length:192},(_,i)=>base+i*3600);
        const fineTime = Array.from({length:196},(_,i)=>Math.floor(Date.now()/900000)*900-3600+i*900);
        const minutely_15 = {time:fineTime,...Object.fromEntries(Object.entries(defaults).filter(([k])=>k!=='precipitation_probability').map(([k,v])=>[k,fineTime.map(()=>v)]))};
        return reply(200, {minutely_15,hourly:{time,...Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,time.map(()=>v)]))},current:{time:base+86400,...defaults}});
      }
    }
    reply(500, {error:'Unexpected fixture request'});
  });
  return new Promise(resolve => server.listen(port,'0.0.0.0',()=>resolve(server)));
}
