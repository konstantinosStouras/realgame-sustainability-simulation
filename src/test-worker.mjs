import { TestClassroom } from './test-classroom.mjs?v=7beae5b8cfb8';

const rooms = new Map();
onconnect = event => {
  const port = event.ports[0];
  port.onmessage = ({data}) => {
    const {requestId, action, roomId, key, payload} = data;
    try {
      let room = rooms.get(roomId), result;
      if (action === 'create') {
        room = new TestClassroom(payload.template, payload.groups); rooms.set(room.state.id, room);
        result = {roomId:room.state.id, key:room.people[0].key};
      } else {
        if (!room) throw Object.assign(new Error('This temporary test round has ended. Start a new test round from your instructor workspace.'), {status:410});
        room.actor(key);
        if (action === 'view') result = room.view(key, payload?.preview);
        else if (action === 'command') result = room.command(key,payload);
        else if (action === 'roster') result = room.roster(key);
        else if (action === 'end') { room.roster(key); rooms.delete(roomId); result = {ok:true}; }
        else throw new Error('Unknown test-round action.');
      }
      port.postMessage({requestId,result});
    } catch(error) { port.postMessage({requestId,error:error.message,status:error.status || 400}); }
  };
  port.start();
};
setInterval(() => { for (const room of rooms.values()) room.advance(Date.now()); }, 1000);
