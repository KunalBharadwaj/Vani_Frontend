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
    const [localVideoStream, setLocalVideoStream] = useState(null);

    const [transportsConnected, setTransportsConnected] = useState(false);
    const sendTransportRef = useRef(null);
    const recvTransportRef = useRef(null);

    // We need to keep a reference to sendWsMessage since we might need it inside callbacks
    const sendWsMessageRef = useRef(null);
    // Store promises to await responses from websocket
    const pendingRequestsRef = useRef(new Map());

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
            // Someone just produced, let's consume it!
            // But we need to know its kind. We could just call getProducers again.
            if (recvTransportRef.current && (isAudioActive || isVideoActive)) {
                // We just fetch all active producers and consume the ones we don't have
                sendWsMessageRef.current?.({ type: 'webrtc:getProducers' });
            }
        }

        if (data.type === 'webrtc:activeProducers') {
            const { producers } = data;
            producers.forEach(p => {
                if ((p.kind === 'audio' && isAudioActive && !audioConsumersRef.current.has(p.id)) ||
                    (p.kind === 'video' && isVideoActive && !videoConsumersRef.current.has(p.id))) {
                    consumeExistingProducer(p.id, p.kind);
                }
            });
        }

    }, [isAudioActive, isVideoActive]);

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
        if (device) return device;
        try {
            const res = await requestWs('webrtc:getRouterRtpCapabilities', {}, 'webrtc:routerRtpCapabilities');
            const newDevice = new mediasoupClient.Device();
            await newDevice.load({ routerRtpCapabilities: res.rtpCapabilities });
            setDevice(newDevice);
            return newDevice;
        } catch (err) {
            console.error('Failed to load mediasoup device', err);
            toast.error('Could not initialize media connection');
            return null;
        }
    };

    const ensureTransports = async (activeDevice) => {
        if (transportsConnected) return;
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
        try {
            const res = await requestWs('webrtc:consume', {
                transportId: recvTransportRef.current.id,
                producerId,
                rtpCapabilities: device.rtpCapabilities
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
            sendWsMessage({ type: 'webrtc:resumeConsumer', consumerId: consumer.id });

        } catch (err) {
            console.error("Failed to consume", producerId, err);
        }
    };

    const toggleAudio = async () => {
        if (isAudioActive) {
            // Disconnect
            audioProducerRef.current?.close();
            audioProducerRef.current = null;
            // Clean up consumers
            audioConsumersRef.current.forEach(({ consumer }) => consumer.close());
            audioConsumersRef.current.clear();
            setRemoteAudioStreams([]);
            setIsAudioActive(false);
            return;
        }

        // Connect
        try {
            const dev = await connectMediasoup();
            if (!dev) return;
            await ensureTransports(dev);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioTrack = stream.getAudioTracks()[0];

            audioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack });

            // Fetch existing producers to consume
            sendWsMessage({ type: 'webrtc:getProducers' });

            setIsAudioActive(true);
            toast.success("Joined Audio Chat");

        } catch (err) {
            console.error(err);
            toast.error("Could not capture audio");
        }
    };

    const toggleVideo = async () => {
        if (isVideoActive) {
            videoProducerRef.current?.close();
            videoProducerRef.current = null;
            setLocalVideoStream(null);

            videoConsumersRef.current.forEach(({ consumer }) => consumer.close());
            videoConsumersRef.current.clear();
            setRemoteVideoStreams([]);
            setIsVideoActive(false);
            return;
        }

        try {
            const dev = await connectMediasoup();
            if (!dev) return;
            await ensureTransports(dev);

            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = stream.getVideoTracks()[0];

            videoProducerRef.current = await sendTransportRef.current.produce({ track: videoTrack });
            setLocalVideoStream(stream);

            sendWsMessage({ type: 'webrtc:getProducers' });

            setIsVideoActive(true);
            toast.success("Joined Video Chat");
        } catch (err) {
            console.error(err);
            toast.error("Could not capture video");
        }
    };

    // Ensure cleanup if component unmounts
    useEffect(() => {
        return () => {
            if (audioProducerRef.current && !audioProducerRef.current.closed) audioProducerRef.current.close();
            if (videoProducerRef.current && !videoProducerRef.current.closed) videoProducerRef.current.close();
        };
    }, []);

    return (
        <MediaContext.Provider value={{
            isAudioActive, toggleAudio,
            isVideoActive, toggleVideo,
            localVideoStream, remoteVideoStreams
        }}>
            {children}
        </MediaContext.Provider>
    );
};

export const useMedia = () => useContext(MediaContext);
