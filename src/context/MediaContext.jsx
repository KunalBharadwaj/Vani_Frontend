import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { useCollaboration } from '@/hooks/useCollaboration';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { AuthContext } from '@/App';

const MediaContext = createContext(null);

// Agora client — one per app lifecycle, not per component mount
const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://vanibackend-production.up.railway.app';

export const MediaProvider = ({ children }) => {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');
    const token = useContext(AuthContext);

    // Audio state
    const [isAudioActive, setIsAudioActive] = useState(false);
    const localAudioTrackRef = useRef(null);

    // Video state
    const [isVideoActive, setIsVideoActive] = useState(false);
    const localVideoTrackRef = useRef(null);
    const [localVideoTrack, setLocalVideoTrack] = useState(null);

    // Remote users: map of uid -> { audioTrack?, videoTrack? }
    const [remoteUsers, setRemoteUsers] = useState(new Map());

    // Derived: list of remote video tracks for VideoChat component
    const remoteVideoTracks = Array.from(remoteUsers.values())
        .map(u => u.videoTrack)
        .filter(Boolean);

    // For RoomDashboard: who is currently in audio/video
    const [remoteProducersMetadata, setRemoteProducersMetadata] = useState([]);

    // Incoming call state (ring notification via WebSocket — unchanged)
    const [incomingCall, setIncomingCall] = useState(null);
    const dismissedCallersRef = useRef(new Map());

    const currentUserId = token
        ? (() => { try { return JSON.parse(atob(token.split('.')[1]))?.id || null; } catch { return null; } })()
        : null;

    const sendWsMessageRef = useRef(null);
    const joinedRef = useRef(false); // Prevent double-join

    // ─── Agora event handlers ───────────────────────────────────────────────

    useEffect(() => {
        const handleUserPublished = async (user, mediaType) => {
            await agoraClient.subscribe(user, mediaType);

            setRemoteUsers(prev => {
                const next = new Map(prev);
                const existing = next.get(user.uid) || {};
                next.set(user.uid, { ...existing, [mediaType === 'audio' ? 'audioTrack' : 'videoTrack']: user[mediaType === 'audio' ? 'audioTrack' : 'videoTrack'] });
                return next;
            });

            if (mediaType === 'audio' && user.audioTrack) {
                user.audioTrack.play();
            }

            setRemoteProducersMetadata(prev => {
                const uid = String(user.uid);
                const filtered = prev.filter(p => !(p.userId === uid && p.kind === mediaType));
                return [...filtered, { id: `${uid}-${mediaType}`, kind: mediaType, userId: uid }];
            });
        };

        const handleUserUnpublished = (user, mediaType) => {
            setRemoteUsers(prev => {
                const next = new Map(prev);
                const existing = next.get(user.uid);
                if (existing) {
                    const updated = { ...existing };
                    delete updated[mediaType === 'audio' ? 'audioTrack' : 'videoTrack'];
                    if (Object.keys(updated).length === 0) {
                        next.delete(user.uid);
                    } else {
                        next.set(user.uid, updated);
                    }
                }
                return next;
            });

            setRemoteProducersMetadata(prev =>
                prev.filter(p => !(p.userId === String(user.uid) && p.kind === mediaType))
            );
        };

        const handleUserLeft = (user) => {
            setRemoteUsers(prev => {
                const next = new Map(prev);
                next.delete(user.uid);
                return next;
            });
            setRemoteProducersMetadata(prev => prev.filter(p => p.userId !== String(user.uid)));
        };

        agoraClient.on('user-published', handleUserPublished);
        agoraClient.on('user-unpublished', handleUserUnpublished);
        agoraClient.on('user-left', handleUserLeft);

        return () => {
            agoraClient.off('user-published', handleUserPublished);
            agoraClient.off('user-unpublished', handleUserUnpublished);
            agoraClient.off('user-left', handleUserLeft);
        };
    }, []);

    // ─── WebSocket (unchanged — for ring notifications only) ─────────────────

    const handleMessage = useCallback((data) => {
        if (data.type === 'webrtc:incomingCallRequest') {
            const callerId = data.callerId || null;
            const dismissedAt = callerId ? dismissedCallersRef.current.get(callerId) : null;
            const isDismissedRecently = dismissedAt ? (Date.now() - dismissedAt) < 30000 : false;

            if (callerId && callerId !== currentUserId && !isDismissedRecently) {
                setIncomingCall(prev => {
                    const next = prev ? { ...prev } : { callerId, callerName: data.callerName || 'Someone', wantsAudio: false, wantsVideo: false };
                    next.callerId = callerId;
                    next.callerName = data.callerName || next.callerName;
                    if (data.wantsAudio) next.wantsAudio = true;
                    if (data.wantsVideo) next.wantsVideo = true;
                    return next;
                });
            }
        }

        if (data.type === 'webrtc:callAccepted') {
            toast.success(`${data.senderName || 'Participant'} accepted the call`);
        }

        if (data.type === 'webrtc:callDeclined') {
            toast.error(`${data.senderName || 'Participant'} declined the call`);
            stopAudio();
            stopVideo();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUserId]);

    const { sendWsMessage, status } = useCollaboration(roomId, token, handleMessage);

    useEffect(() => {
        sendWsMessageRef.current = sendWsMessage;
    }, [sendWsMessage]);

    // ─── Agora join/leave helpers ─────────────────────────────────────────────

    const fetchAgoraToken = async () => {
        const res = await fetch(
            `${BACKEND_URL}/api/agora/token?channel=${encodeURIComponent(roomId)}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error('Failed to fetch Agora token');
        return res.json(); // { token, uid, appId }
    };

    const ensureJoined = async () => {
        if (joinedRef.current) return;
        const { token: agoraToken, uid, appId } = await fetchAgoraToken();
        await agoraClient.join(appId, roomId, agoraToken, uid);
        joinedRef.current = true;
    };

    const leaveIfIdle = async () => {
        if (!localAudioTrackRef.current && !localVideoTrackRef.current) {
            await agoraClient.leave();
            joinedRef.current = false;
        }
    };

    // ─── Audio ────────────────────────────────────────────────────────────────

    const startAudio = async () => {
        if (isAudioActive) return true;
        try {
            await ensureJoined();
            const track = await AgoraRTC.createMicrophoneAudioTrack();
            await agoraClient.publish([track]);
            localAudioTrackRef.current = track;
            setIsAudioActive(true);
            toast.success('Joined Audio Chat');
            return true;
        } catch (err) {
            console.error(err);
            toast.error('Could not capture audio');
            return false;
        }
    };

    const stopAudio = async () => {
        if (localAudioTrackRef.current) {
            await agoraClient.unpublish([localAudioTrackRef.current]);
            localAudioTrackRef.current.close();
            localAudioTrackRef.current = null;
        }
        setIsAudioActive(false);
        await leaveIfIdle();
    };

    const toggleAudio = async () => {
        if (isAudioActive) { await stopAudio(); } else { await startAudio(); }
    };

    // ─── Video ────────────────────────────────────────────────────────────────

    const startVideo = async () => {
        if (isVideoActive) return true;
        try {
            await ensureJoined();
            const track = await AgoraRTC.createCameraVideoTrack();
            await agoraClient.publish([track]);
            localVideoTrackRef.current = track;
            setLocalVideoTrack(track);
            setIsVideoActive(true);
            toast.success('Joined Video Chat');
            return true;
        } catch (err) {
            console.error(err);
            toast.error('Could not capture video');
            return false;
        }
    };

    const stopVideo = async () => {
        if (localVideoTrackRef.current) {
            await agoraClient.unpublish([localVideoTrackRef.current]);
            localVideoTrackRef.current.close();
            localVideoTrackRef.current = null;
        }
        setLocalVideoTrack(null);
        setIsVideoActive(false);
        await leaveIfIdle();
    };

    const toggleVideo = async () => {
        if (isVideoActive) { await stopVideo(); } else { await startVideo(); }
    };

    // ─── Ring / Call invitation (via WebSocket — unchanged UX) ───────────────

    const ringPlayer = (targetUserId, wantsAudio, wantsVideo) => {
        sendWsMessage({ type: 'webrtc:requestCall', targetUserId, wantsAudio, wantsVideo });
        toast.info('Call request sent');
    };

    const acceptIncomingCall = async () => {
        if (!incomingCall) return;
        if (incomingCall.callerId) dismissedCallersRef.current.delete(incomingCall.callerId);
        if (incomingCall.wantsAudio) await startAudio();
        if (incomingCall.wantsVideo) await startVideo();
        sendWsMessageRef.current?.({
            type: 'webrtc:callAccepted',
            targetUserId: incomingCall.callerId,
            acceptedAudio: !!incomingCall.wantsAudio,
            acceptedVideo: !!incomingCall.wantsVideo,
        });
        toast.success(`Connected to ${incomingCall.callerName}'s call`);
        setIncomingCall(null);
    };

    const declineIncomingCall = () => {
        if (incomingCall?.callerId) {
            dismissedCallersRef.current.set(incomingCall.callerId, Date.now());
            sendWsMessage({ type: 'webrtc:callDeclined', targetUserId: incomingCall.callerId });
        }
        setIncomingCall(null);
        toast('Call declined');
    };

    // ─── Cleanup on unmount ───────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            localAudioTrackRef.current?.close();
            localVideoTrackRef.current?.close();
            if (joinedRef.current) agoraClient.leave().catch(() => {});
        };
    }, []);

    return (
        <MediaContext.Provider value={{
            isAudioActive, toggleAudio,
            isVideoActive, toggleVideo,
            localVideoTrack,       // Agora ILocalVideoTrack (used by VideoChat)
            remoteVideoTracks,     // Agora IRemoteVideoTrack[] (used by VideoChat)
            // Keep legacy prop names so VideoChat/RoomDashboard don't need changes
            localVideoStream: localVideoTrack,
            remoteVideoStreams: remoteVideoTracks,
            remoteProducersMetadata,
            ringPlayer,
        }}>
            {children}
            {incomingCall && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] bg-zinc-900 text-white border border-white/20 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-4">
                    <div className="text-sm">
                        <div className="font-semibold">{incomingCall.callerName} is calling</div>
                        <div className="text-white/70 text-xs">
                            {incomingCall.wantsAudio && incomingCall.wantsVideo ? 'Audio + Video' : incomingCall.wantsVideo ? 'Video call' : 'Audio call'}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={declineIncomingCall}
                            className="px-3 py-1.5 rounded-md text-sm bg-red-500/20 text-red-300 hover:bg-red-500/30">Decline</button>
                        <button type="button" onClick={acceptIncomingCall}
                            className="px-3 py-1.5 rounded-md text-sm bg-green-500/20 text-green-300 hover:bg-green-500/30">Accept</button>
                    </div>
                </div>
            )}
        </MediaContext.Provider>
    );
};

export const useMedia = () => useContext(MediaContext);
