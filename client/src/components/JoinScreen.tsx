import { useState } from "react";
import { useSocket } from "../contexts/SocketContext";

export function JoinScreen() {
  const { joinRoom, isConnected } = useSocket();
  const [userName, setUserName] = useState("");
  const [roomId, setRoomId] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userName.trim() && roomId.trim()) {
      joinRoom(roomId.trim(), userName.trim());
    }
  };

  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Collaborative Whiteboard
          </h1>
          <p className="text-gray-500 mt-2">
            Draw together in real-time with others
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="userName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Your Name
            </label>
            <input
              type="text"
              id="userName"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
              maxLength={20}
              required
            />
          </div>

          <div>
            <label
              htmlFor="roomId"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Room Code
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="roomId"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="Enter room code"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all uppercase"
                maxLength={10}
                required
              />
              <button
                type="button"
                onClick={generateRoomId}
                className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                New
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Create a new room or join an existing one
            </p>
          </div>

          <button
            type="submit"
            disabled={!isConnected || !userName.trim() || !roomId.trim()}
            className="w-full py-3 bg-primary-500 text-white rounded-lg font-medium hover:bg-primary-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isConnected ? "Join Room" : "Connecting..."}
          </button>
        </form>

        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-2 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-gray-500">
              {isConnected ? "Connected to server" : "Connecting..."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
