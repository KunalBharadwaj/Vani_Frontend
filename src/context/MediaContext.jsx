import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { useCollaboration } from '@/hooks/useCollaboration';
import * as mediasoupClient from 'mediasoup-client';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { AuthContext } from '@/App';

const MediaContext = createContext(null);

export const MediaProvider = ({ children }) => {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');
    const token = useContext(AuthContext);

    const [device, setDevice] = useState(null);
    const deviceRef = useRef(null);

    // Audio state
    const [isAudioActive, setIsAudioActive] = useState(false);
    const audioProducerRef = useRef(null);
    const audioConsumersRef = useRef(new Map()); // id -> { consumer, stream }
    const [remoteAudioStreams, setRemoteAudioStreams] = useState([]); // Array of MediaStream

    // Video state
    const [isVideoActive, setIsVideoActive] = useState(false);
    const videoProducerRef = useRef(null);
    const videoConsumersRef = useRef(new Map()); // id -> { consumer, stream }
    const [remoteVideoStreams, setRemoteVideoStreams] = useState([]); // Array of MediaStream
    const localVideoStreamRef = useRef(null);
    const localAudioStreamRef = useRef(null);
    const [localVideoStream, setLocalVideoStream] = useState(null);
    const [remoteProducersMetadata, setRemoteProducersMetadata] = useState([]); // [{id, kind, userId}]
    const [incomingCall, setIncomingCall] = useState(null); // { callerId, callerName, wantsAudio, wantsVideo }
    const dismissedCallersRef = useRef(new Map()); // callerId -> dismissTimestamp

    const [transportsConnected, setTransportsConnected] = useState(false);
    const currentUserId = token
        ? (() => {
            try {
                return JSON.parse(atob(token.split('.')[1]))?.id || null;
            } catch {
                return null;
            }
        })()
        : null;

    const sendTransportRef = useRef(null);
    const recvTransportRef = useRef(null);

    // We need to keep a reference to sendWsMessage since we might need it inside callbacks
    const sendWsMessageRef = useRef(null);
    // Store promises to await responses from websocket
    const pendingRequestsRef = useRef(new Map());
    const consumeMutexRef = useRef(Promise.resolve());

    const handleMessage = useCallback((data) => {
        // Resolve pending requests if they match the type
        if (data.type) {
            const qList = pendingRequestsRef.current.get(data.type);
            if (qList && qList.length > 0) {
                const resolve = qList.shift();
                resolve(data);
            }
        }

        if (data.type === 'webrtc:newProducer') {
            const producerKind = data.kind;
            const producerId = data.producerId;
            const callerId = data.callerId || null;

            setRemoteProducersMetadata(prev => {
                if (prev.find(p => p.id === producerId)) return prev;
                return [...prev, { id: producerId, kind: producerKind, userId: callerId }];
            });

            if (recvTransportRef.current && (isAudioActive || isVideoActive)) {
                sendWsMessageRef.current?.({ type: 'webrtc:getProducers' });
            }
        }

        if (data.type === 'webrtc:activeProducers') {
            const { producers } = data;
            setRemoteProducersMetadata(producers);
            
            producers.forEach(p => {
                const canConsumeAudio = isAudioActive || !!audioProducerRef.current;
                const canConsumeVideo = isVideoActive || !!videoProducerRef.current;
                if ((p.kind === 'audio' && canConsumeAudio && !audioConsumersRef.current.has(p.id)) ||
                    (p.kind === 'video' && canConsumeVideo && !videoConsumersRef.current.has(p.id))) {
                    consumeExistingProducer(p.id, p.kind);
                }
            });
        }

        if (data.type === 'webrtc:producerRemoved') {
            const producerId = data.producerId;
            setRemoteProducersMetadata(prev => prev.filter(p => p.id !== producerId));
            
            if (audioConsumersRef.current.has(producerId)) {
                audioConsumersRef.current.get(producerId).consumer.close();
                audioConsumersRef.current.delete(producerId);
                setRemoteAudioStreams(Array.from(audioConsumersRef.current.values()).map(v => v.stream));
            }
            if (videoConsumersRef.current.has(producerId)) {
                videoConsumersRef.current.get(producerId).consumer.close();
                videoConsumersRef.current.delete(producerId);
                setRemoteVideoStreams(Array.from(videoConsumersRef.current.values()).map(v => v.stream));
            }
        }

        if (data.type === 'webrtc:incomingCallRequest') {
             const callerId = data.callerId || null;
             const dismissedAt = callerId ? dismissedCallersRef.current.get(callerId) : null;
             const isDismissedRecently = dismissedAt ? (Date.now() - dismissedAt) < 30000 : false;
             
             if (
                 callerId &&
                 callerId !== currentUserId &&
                 !isDismissedRecently
             ) {
                 setIncomingCall((prev) => {
                     const next = prev ? { ...prev } : {
                         callerId,
                         callerName: data.callerName || 'Someone',
                         wantsAudio: false,
                         wantsVideo: false,
                     };
                     next.callerId = callerId;
                     next.callerName = data.callerName || next.callerName || 'Someone';
                     if (data.wantsAudio) next.wantsAudio = true;
                     if (data.wantsVideo) next.wantsVideo = true;
                     return next;
                 });
             }
        }

        if (data.type === 'webrtc:callAccepted') {
            toast.success(`${data.senderName || 'Participant'} accepted the call`);
            if (recvTransportRef.current && (isAudioActive || isVideoActive)) {
                sendWsMessageRef.current?.({ type: 'webrtc:getProducers' });
            }
        }

        if (data.type === 'webrtc:callDeclined') {
            toast.error(`${data.senderName || 'Participant'} declined the call`);

            // In 1:1 flow, stop outgoing media when call is declined.
            if (isAudioActive) {
                audioProducerRef.current?.close();
                audioProducerRef.current = null;
                audioConsumersRef.current.forEach(({ consumer }) => consumer.close());
                audioConsumersRef.current.clear();
                setRemoteAudioStreams([]);
                setIsAudioActive(false);
            }

            if (isVideoActive) {
                videoProducerRef.current?.close();
                videoProducerRef.current = null;
                setLocalVideoStream(null);
                videoConsumersRef.current.forEach(({ consumer }) => consumer.close());
                videoConsumersRef.current.clear();
                setRemoteVideoStreams([]);
                setIsVideoActive(false);
            }
        }

    }, [isAudioActive, isVideoActive, currentUserId]);

    const { sendWsMessage, status } = useCollaboration(roomId, token, handleMessage);

    useEffect(() => {
        sendWsMessageRef.current = sendWsMessage;
    }, [sendWsMessage]);

    // Request abstraction over WebSocket
    const requestWs = async (reqType, payload, resType) => {
        return new Promise((resolve, reject) => {
            let timeout = setTimeout(() => reject(new Error("Timeout waiting for " + resType)), 5000);
            const qList = pendingRequestsRef.current.get(resType) || [];
            qList.push((data) => {
                clearTimeout(timeout);
                resolve(data);
            });
            pendingRequestsRef.current.set(resType, qList);
            sendWsMessage({ type: reqType, ...payload });
        });
    };

    const connectMediasoup = async () => {
        if (deviceRef.current) return deviceRef.current;
        try {
            const res = await requestWs('webrtc:getRouterRtpCapabilities', {}, 'webrtc:routerRtpCapabilities');
            const newDevice = new mediasoupClient.Device();
            await newDevice.load({ routerRtpCapabilities: res.rtpCapabilities });
            deviceRef.current = newDevice;
            setDevice(newDevice);
            return newDevice;
        } catch (err) {
            console.error('Failed to load mediasoup device', err);
            toast.error('Could not initialize media connection');
            return null;
        }
    };

    const ensureTransports = async (activeDevice) => {
        if (sendTransportRef.current && recvTransportRef.current) return;
        try {
            // Create Send Transport
            const sendRes = await requestWs('webrtc:createTransport', {}, 'webrtc:transportCreated');
            sendTransportRef.current = activeDevice.createSendTransport(sendRes);

            sendTransportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    await requestWs('webrtc:connectTransport', { transportId: sendTransportRef.current.id, dtlsParameters }, 'webrtc:transportConnected');
                    callback();
                } catch (e) { errback(e); }
            });

            sendTransportRef.current.on('produce', async (parameters, callback, errback) => {
                try {
                    const pRes = await requestWs('webrtc:produce', {
                        transportId: sendTransportRef.current.id,
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: parameters.appData
                    }, 'webrtc:produced');
                    callback({ id: pRes.id });
                } catch (e) { errback(e); }
            });

            // Create Receive Transport
            const recvRes = await requestWs('webrtc:createTransport', {}, 'webrtc:transportCreated');
            recvTransportRef.current = activeDevice.createRecvTransport(recvRes);

            recvTransportRef.current.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    await requestWs('webrtc:connectTransport', { transportId: recvTransportRef.current.id, dtlsParameters }, 'webrtc:transportConnected');
                    callback();
                } catch (e) { errback(e); }
            });

            setTransportsConnected(true);
        } catch (err) {
            console.error('Failed to init transports', err);
            toast.error('Media transport error');
            throw err;
        }
    };

    const consumeExistingProducer = async (producerId, kind) => {
        return new Promise((resolve) => {
            consumeMutexRef.current = consumeMutexRef.current.then(async () => {
                try {
                    const activeDevice = deviceRef.current || device;
                    if (!activeDevice || !recvTransportRef.current) {
                        resolve();
                        return;
                    }

                    const res = await requestWs('webrtc:consume', {
                        transportId: recvTransportRef.current.id,
                        producerId,
                        rtpCapabilities: activeDevice.rtpCapabilities
                    }, 'webrtc:consumed');

                    const consumer = await recvTransportRef.current.consume({
                        id: res.id,
                        producerId: res.producerId,
                        kind: res.kind,
                        rtpParameters: res.rtpParameters
                    });

                    const stream = new MediaStream([consumer.track]);

                    if (kind === 'audio') {
                        audioConsumersRef.current.set(producerId, { consumer, stream });
                        setRemoteAudioStreams(Array.from(audioConsumersRef.current.values()).map(v => v.stream));

                        // Automatically attach stream to a new dynamically created Audio element
                        const audioEl = new Audio();
                        audioEl.srcObject = stream;
                        audioEl.play().catch(console.error);

                    } else if (kind === 'video') {
                        videoConsumersRef.current.set(producerId, { consumer, stream });
                        setRemoteVideoStreams(Array.from(videoConsumersRef.current.values()).map(v => v.stream));
                    }

                    // Resume consumer on backend
                    sendWsMessageRef.current?.({ type: 'webrtc:resumeConsumer', consumerId: consumer.id });

                } catch (err) {
                    console.error("Failed to consume", producerId, err);
                }
                resolve();
            });
        });
    };

    const startAudio = async () => {
        if (isAudioActive) return true;
        try {
            const dev = await connectMediasoup();
            if (!dev) return false;
            await ensureTransports(dev);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localAudioStreamRef.current = stream;
            const audioTrack = stream.getAudioTracks()[0];

            audioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack });
            setIsAudioActive(true);

            // Fetch existing producers to consume
            sendWsMessage({ type: 'webrtc:getProducers' });

            toast.success("Joined Audio Chat");
            return true;

        } catch (err) {
            console.error(err);
            toast.error("Could not capture audio");
            return false;
        }
    };

    const stopAudio = () => {
        localAudioStreamRef.current?.getTracks().forEach(track => track.stop());
        localAudioStreamRef.current = null;
        if (audioProducerRef.current) {
            audioProducerRef.current.close();
            sendWsMessageRef.current?.({ type: 'webrtc:closeProducer', producerId: audioProducerRef.current.id });
            audioProducerRef.current = null;
        }
        audioConsumersRef.current.forEach(({ consumer }) => consumer.close());
        audioConsumersRef.current.clear();
        setRemoteAudioStreams([]);
        setIsAudioActive(false);
    }; // Sync Fix

    const startVideo = async () => {
        if (isVideoActive) return true;
        try {
            const dev = await connectMediasoup();
            if (!dev) return false;
            await ensureTransports(dev);

            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            localVideoStreamRef.current = stream;
            const videoTrack = stream.getVideoTracks()[0];

            videoProducerRef.current = await sendTransportRef.current.produce({ track: videoTrack });
            setLocalVideoStream(stream);
            setIsVideoActive(true);

            sendWsMessage({ type: 'webrtc:getProducers' });

            toast.success("Joined Video Chat");
            return true;
        } catch (err) {
            console.error(err);
            toast.error("Could not capture video");
            return false;
        }
    };

    const stopVideo = () => {
        localVideoStreamRef.current?.getTracks().forEach(track => track.stop());
        localVideoStreamRef.current = null;
        if (videoProducerRef.current) {
            videoProducerRef.current.close();
            sendWsMessageRef.current?.({ type: 'webrtc:closeProducer', producerId: videoProducerRef.current.id });
            videoProducerRef.current = null;
        }
        setLocalVideoStream(null);

        videoConsumersRef.current.forEach(({ consumer }) => consumer.close());
        videoConsumersRef.current.clear();
        setRemoteVideoStreams([]);
        setIsVideoActive(false);
    };

    const toggleAudio = async () => {
        if (isAudioActive) {
            stopAudio();
            return;
        }
        await startAudio();
    };

    const toggleVideo = async () => {
        if (isVideoActive) {
            stopVideo();
            return;
        }
        await startVideo();
    };

    const acceptIncomingCall = async () => {
        if (!incomingCall) return;

        if (incomingCall.callerId) {
            dismissedCallersRef.current.delete(incomingCall.callerId);
        }

        let joinedAudio = false;
        let joinedVideo = false;
        const needsAudio = incomingCall.wantsAudio && !isAudioActive;
        const needsVideo = incomingCall.wantsVideo && !isVideoActive;

        if (needsAudio && needsVideo) {
            try {
                const dev = await connectMediasoup();
                if (dev) {
                    await ensureTransports(dev);
                    
                    // Request remote streams immediately so we can see them even if our hardware fails
                    sendWsMessageRef.current?.({ type: 'webrtc:getProducers' });

                    let stream;
                    try {
                        // Request both streams simultaneously
                        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                        joinedAudio = true;
                        joinedVideo = true;
                    } catch (hardwareErr) {
                        console.warn("Combined media capture failed, falling back to audio only. Usually caused by testing two browsers on the same PC locking the webcam.", hardwareErr);
                        toast.error("Camera locked. Falling back to audio only.");
                        try {
                            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            joinedAudio = true;
                        } catch (audioErr) {
                            console.error("Audio capture also failed", audioErr);
                            toast.error("Could not capture any media.");
                            stream = null;
                        }
                    }

                    if (stream) {
                        const audioTrack = stream.getAudioTracks()[0];
                        if (audioTrack) {
                            localAudioStreamRef.current = stream;
                            audioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack });
                            setIsAudioActive(true);
                        }
                        
                        const videoTrack = stream.getVideoTracks()[0];
                        if (videoTrack) {
                            localVideoStreamRef.current = stream;
                            videoProducerRef.current = await sendTransportRef.current.produce({ track: videoTrack });
                            setLocalVideoStream(stream);
                            setIsVideoActive(true);
                        }
                    }
                }
            } catch (err) {
                console.error("Transport setup failed", err);
                toast.error("Could not connect media transport securely");
            }
        } else {
            if (needsAudio) joinedAudio = await startAudio();
            if (needsVideo) joinedVideo = await startVideo();
        }

        const joinedAnything = joinedAudio || joinedVideo;

        if (joinedAnything) {
            sendWsMessageRef.current?.({
                type: 'webrtc:callAccepted',
                targetUserId: incomingCall.callerId,
                acceptedAudio: !!incomingCall.wantsAudio,
                acceptedVideo: !!incomingCall.wantsVideo
            });
            toast.success(`Connected to ${incomingCall.callerName}'s call`);
        }
        setIncomingCall(null);
    };

    const declineIncomingCall = () => {
        if (incomingCall?.callerId) {
            dismissedCallersRef.current.set(incomingCall.callerId, Date.now());
            sendWsMessage({
                type: 'webrtc:callDeclined',
                targetUserId: incomingCall.callerId
            });
        }
        setIncomingCall(null);
        toast("Call declined");
    };

    // Ensure cleanup if component unmounts
    useEffect(() => {
        return () => {
            if (audioProducerRef.current && !audioProducerRef.current.closed) audioProducerRef.current.close();
            if (videoProducerRef.current && !videoProducerRef.current.closed) videoProducerRef.current.close();
        };
    }, []);

    const ringPlayer = (targetUserId, wantsAudio, wantsVideo) => {
        sendWsMessage({
            type: 'webrtc:requestCall',
            targetUserId,
            wantsAudio,
            wantsVideo
        });
        toast.info("Call request sent");
    };

    return (
        <MediaContext.Provider value={{
            isAudioActive, toggleAudio,
            isVideoActive, toggleVideo,
            localVideoStream, remoteVideoStreams,
            remoteProducersMetadata, ringPlayer
        }}>
            {children}
            {incomingCall && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] bg-zinc-900 text-white border border-white/20 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-4">
                    <div className="text-sm">
                        <div className="font-semibold">{incomingCall.callerName} is calling</div>
                        <div className="text-white/70 text-xs">
                            {incomingCall.wantsAudio && incomingCall.wantsVideo
                                ? "Audio + Video"
                                : incomingCall.wantsVideo
                                    ? "Video call"
                                    : "Audio call"}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={declineIncomingCall}
                            className="px-3 py-1.5 rounded-md text-sm bg-red-500/20 text-red-300 hover:bg-red-500/30"
                        >
                            Decline
                        </button>
                        <button
                            type="button"
                            onClick={acceptIncomingCall}
                            className="px-3 py-1.5 rounded-md text-sm bg-green-500/20 text-green-300 hover:bg-green-500/30"
                        >
                            Accept
                        </button>
                    </div>
                </div>
            )}
        </MediaContext.Provider>
    );
};

export const useMedia = () => useContext(MediaContext);
// forced sync update
