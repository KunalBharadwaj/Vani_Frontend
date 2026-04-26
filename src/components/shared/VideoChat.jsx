import React, { useState, useEffect, useRef } from 'react';
import { useMedia } from '@/context/MediaContext';
import { Maximize2, Minimize2, PhoneOff, Video } from 'lucide-react';

const VideoStream = ({ stream, isLocal }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div className="relative w-full h-full bg-black rounded-lg overflow-hidden border border-white/10 shadow-lg">
            {stream ? (
                <video 
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={isLocal} // Always mute local video
                    className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-white/50">
                    <Video className="w-8 h-8 opacity-50" />
                </div>
            )}
            {isLocal && (
                <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded text-xs text-white">
                    You
                </div>
            )}
        </div>
    );
};

export const VideoChat = () => {
    const { isVideoActive, toggleVideo, localVideoStream, remoteVideoStreams } = useMedia();
    const [isMaximized, setIsMaximized] = useState(false);

    if (!isVideoActive) return null;

    const allStreams = [
        { stream: localVideoStream, isLocal: true, id: 'local' },
        ...remoteVideoStreams.map((s, i) => ({ stream: s, isLocal: false, id: `remote-${i}` }))
    ];

    // Calculate grid based on number of participants
    let gridCols = 1;
    if (allStreams.length > 4) gridCols = 3;
    else if (allStreams.length > 1) gridCols = 2;

    const containerStyle = isMaximized 
        ? "fixed inset-0 z-[100] bg-black/95 p-6 flex flex-col backdrop-blur-md transition-all duration-300"
        : "fixed bottom-6 right-6 z-[60] w-72 max-h-96 bg-zinc-900 border border-white/20 rounded-xl shadow-2xl flex flex-col transition-all duration-300";

    return (
        <div className={containerStyle}>
            {/* Header / Controls */}
            <div className={`flex items-center justify-between pointer-events-auto ${isMaximized ? 'mb-4' : 'p-2 border-b border-white/10'}`}>
                <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-white">Video Call</span>
                </div>
                <div className="flex items-center gap-1">
                    <button 
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                        title={isMaximized ? "Minimize" : "Maximize"}
                    >
                        {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                    <button 
                        onClick={toggleVideo}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-500 transition-colors"
                        title="Disconnect"
                    >
                        <PhoneOff className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Video Grid */}
            <div className={`flex-1 overflow-hidden pointer-events-auto ${isMaximized ? 'h-full' : 'p-2'}`}>
                <div 
                    className="grid gap-2 w-full h-full"
                    style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                >
                    {allStreams.map(({ stream, isLocal, id }) => (
                        <div key={id} className="min-h-0 min-w-0">
                            <VideoStream stream={stream} isLocal={isLocal} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
