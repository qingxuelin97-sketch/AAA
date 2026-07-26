// S7 · 分享卡 Sheet：生成中骨架 → blob 预览 → 系统分享（canShare files）/
// 保存图片（download 兜底）/ 复制链接。合成器按需动态 import，不进首屏包。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Download, Link2 } from 'lucide-react';
import { useToast } from '../ui.jsx';
import { useAppOverlay } from '../overlay.jsx';
import { isAppMode } from '../appmode.js';
import { shareUrl } from '../util.js';
import { tick } from '../appgestures.js';
import { AppButton } from './AppControls.jsx';

export default function ShareCardSheet({ kind, payload, onClose, returnFocusRef }) {
  const appPortal = isAppMode();
  const toast = useToast();
  const sheetRef = useRef(null);
  const [preview, setPreview] = useState('');
  const [blob, setBlob] = useState(null);
  const [failed, setFailed] = useState(false);
  useAppOverlay(true, onClose, { rootRef: sheetRef, isolate: appPortal, returnFocusRef });

  useEffect(() => {
    let alive = true;
    let url = '';
    (async () => {
      try {
        const mod = await import('../sharecard.js');
        const canvas = kind === 'achievement'
          ? await mod.renderAchievementCard(payload)
          : kind === 'streak'
            ? await mod.renderStreakCard(payload)
            : await mod.renderCharacterCard(payload);
        const nextBlob = await mod.canvasToBlob(canvas);
        if (!alive) return;
        url = URL.createObjectURL(nextBlob);
        setBlob(nextBlob);
        setPreview(url);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [kind, payload]);

  const fileName = `huanyu-${kind || 'card'}-${(payload?.name || payload?.streak || 'share')}.png`.replace(/\s+/g, '');

  const systemShare = async () => {
    if (!blob) return;
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '幻域' });
        tick(10);
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // 用户取消不降级
    }
    saveImage();
  };

  const saveImage = () => {
    if (!preview) return;
    try {
      const a = document.createElement('a');
      a.href = preview;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      tick(10);
      toast('卡片已保存，快去分享吧');
    } catch {
      toast('保存失败，可长按预览图保存', 'err');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(payload?.path || '/'));
      toast('链接已复制');
    } catch {
      toast('复制失败，请手动复制地址', 'err');
    }
  };

  const sheet = (
    <div className="app-sheet-mask qa-share-mask" onClick={onClose}>
      <div
        ref={sheetRef}
        className="app-sheet qa-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="生成分享卡"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-sheet-grip" aria-hidden="true" />
        <div className="qa-share-stage" aria-live="polite">
          {failed ? (
            <p className="qa-share-failed" role="alert">卡片生成失败，稍后再试试</p>
          ) : preview ? (
            <img className="qa-share-preview" src={preview} alt="分享卡预览" />
          ) : (
            <div className="qa-share-skel skel" role="status" aria-label="正在生成分享卡" />
          )}
        </div>
        <div className="qa-share-acts">
          <AppButton variant="primary" size="lg" disabled={!blob} onClick={systemShare}>
            <Share2 size={16} /> 系统分享
          </AppButton>
          <AppButton variant="secondary" disabled={!preview} onClick={saveImage}>
            <Download size={16} /> 保存图片
          </AppButton>
          <AppButton variant="tertiary" onClick={copyLink}>
            <Link2 size={16} /> 复制链接
          </AppButton>
        </div>
      </div>
    </div>
  );

  return appPortal && typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}
