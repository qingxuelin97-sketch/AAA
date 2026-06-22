// Shared helpers for the AI image generation feature (绘图页 + 聊天插图共用)。
import { api } from './api.jsx';

// Style presets prepend descriptive tags to the user's prompt. Design language of
// the app is untouched — these only steer the generated artwork.
export const STYLE_PRESETS = [
  { id: 'none', name: '默认', tag: '' },
  { id: 'anime', name: '动漫', tag: 'anime style, vibrant cel shading, clean detailed line art, studio quality' },
  { id: 'real', name: '写实', tag: 'photorealistic, ultra detailed, 8k, cinematic lighting, depth of field' },
  { id: 'ink', name: '国风水墨', tag: 'traditional Chinese ink wash painting, elegant, misty, rice-paper texture' },
  { id: 'oil', name: '油画', tag: 'oil painting, rich impasto brush strokes, classical, warm tones' },
  { id: 'watercolor', name: '水彩', tag: 'soft watercolor illustration, delicate, pastel, gentle gradients' },
  { id: 'cyber', name: '赛博朋克', tag: 'cyberpunk, glowing neon lights, futuristic city, moody atmosphere' },
  { id: 'render3d', name: '3D', tag: '3d render, octane, subsurface scattering, soft global illumination' },
  { id: 'fantasy', name: '奇幻', tag: 'epic fantasy concept art, dramatic lighting, intricate, highly detailed' },
];

export const SIZE_OPTS = [
  { id: '1024x1024', name: '方形', ratio: '1:1' },
  { id: '1024x1536', name: '竖图', ratio: '2:3' },
  { id: '1536x1024', name: '横图', ratio: '3:2' },
];

export const styleTag = (id) => (STYLE_PRESETS.find(s => s.id === id) || {}).tag || '';
export const composePrompt = (prompt, sid) => { const t = styleTag(sid); return t ? `${String(prompt).trim()}, ${t}` : String(prompt).trim(); };

// Calls the platform image service (charges gold server-side, returns the image + new wallet).
export function generateImage({ prompt, size }) {
  return api('/ai/image', { method: 'POST', body: { prompt, size } });
}

// Best-effort download of a data: or remote image URL.
export function downloadImage(url, name = 'huanyu-art') {
  try {
    const a = document.createElement('a');
    a.href = url; a.download = `${name}-${Date.now()}.png`; a.rel = 'noopener';
    if (!url.startsWith('data:')) a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
  } catch { window.open(url, '_blank'); }
}
