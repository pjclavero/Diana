import mqtt from 'mqtt';
const c = mqtt.connect('mqtt://127.0.0.1:18830', {clientId:'debug-sub'});
c.on('connect', () => {
  console.log('connected');
  c.subscribe('targets/v1/#', {qos:1}, (err)=>console.log('sub', err));
});
c.on('message', (t,p)=>console.log('MSG', t, p.toString().slice(0,150)));
setTimeout(()=>process.exit(0), 6000);
