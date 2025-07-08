import AgoraRTC, {
  type ILocalAudioTrack,
  type IMicrophoneAudioTrack,
  type IAgoraRTCClient,
} from "agora-rtc-sdk-ng";

const appId = import.meta.env.VITE_AGORA_APP_ID;
const token = import.meta.env.VITE_AGORA_TOKEN || null;

const rtcUid = Math.floor(Math.random() * 1000000);

const roomid = "main";

const audioTrack: {
  localAudioTrack: IMicrophoneAudioTrack | null;
  remoteAudioTrack: Record<string, ILocalAudioTrack | null>;
} = {
  localAudioTrack: null,
  remoteAudioTrack: {},
};

let rtcClient: IAgoraRTCClient | null;

// Initialize the RTC client and join the room
// This function should be called when someone press "report" button
const initRtc = async () => {
  rtcClient = AgoraRTC.createClient({
    mode: "rtc",
    codec: "vp8",
  });

  // Set the client ID to the random number generated
  rtcClient.on("user-joined", handleUserJoined);
  rtcClient.on("user-published", handleUserPublished);
  rtcClient.on("user-left", handleUserLeft);

  await rtcClient.join(appId, roomid, token, rtcUid);

  audioTrack.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
  rtcClient.publish(audioTrack.localAudioTrack);

  // add user to the room by creating a wrapper
  const userWrapper = `<div class="speaker user-${rtcUid}" id="${rtcUid}">
                      <div class="user-name">User ${rtcUid}</div>
                    </div>`;
  document
    .getElementById("members")
    ?.insertAdjacentHTML("beforeend", userWrapper);
};

const handleUserJoined = async (user: any) => {
  console.log("user joined", user);

  // add user to the room by creating a wrapper
  const userWrapper = `<div class="speaker user-${user.uid}" id="${user.uid}">
                      <div class="user-name">User ${user.uid}</div>
                    </div>`;

  document
    .getElementById("members")
    ?.insertAdjacentHTML("beforeend", userWrapper);
};

const handleUserPublished = async (user: any, mediaType: "audio" | "video") => {
  console.log("user published", user, mediaType);

  // subscribe to the remote audio track
  await rtcClient?.subscribe(user, mediaType);

  if (mediaType === "audio") {
    audioTrack.remoteAudioTrack[user.uid] = user.audioTrack;
    user.audioTrack.play();
  }
};

const handleUserLeft = async (user: any) => {
  console.log("user left", user);

  // remove user from the room by removing the wrapper
  const userWrapper = document.getElementById(user.uid);
  if (userWrapper) {
    userWrapper.remove();
  }

  // stop and close the remote audio track
  if (audioTrack.remoteAudioTrack[user.uid]) {
    await audioTrack.remoteAudioTrack[user.uid]?.stop();
    await audioTrack.remoteAudioTrack[user.uid]?.close();
    delete audioTrack.remoteAudioTrack[user.uid];
  }
};

export const enterRoom = async (e?: any) => {
  if (e && e.preventDefault) e.preventDefault();
  await initRtc();
  // invoke the header to show or have it shown already
};

export const leaveRoom = async () => {
  await audioTrack.localAudioTrack?.stop();
  await audioTrack.localAudioTrack?.close();

  rtcClient?.leave();
  rtcClient?.unpublish();

  // leave room for everyone
};

export const muteLocalAudio = () => {
  if (audioTrack.localAudioTrack) {
    audioTrack.localAudioTrack.setEnabled(false);
  }
};

export const unmuteLocalAudio = () => {
  if (audioTrack.localAudioTrack) {
    audioTrack.localAudioTrack.setEnabled(true);
  }
};

export const Agora = () => {
  return (
    <>
      <div id="members">Agora</div>
      <button onClick={enterRoom}>Enter Room</button>
      <div id="agora-header">
        <h1>Agora Voice Chat</h1>
      </div>
    </>
  );
};
// export default Agora;
