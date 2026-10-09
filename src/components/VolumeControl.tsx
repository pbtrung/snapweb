import type { CSSProperties } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

type VolumeControlProps = {
  label: string;
  volume: number;
  muted: boolean;
  onMuteClick: () => void;
  onChange: (volume: number) => void;
  // Called when a drag or key press that changed the volume ends
  onChangeEnd?: () => void;
};

// Mute button and volume slider
export default function VolumeControl(props: VolumeControlProps) {
  const volume = Math.round(props.volume);
  const Icon = props.muted ? VolumeX : volume < 50 ? Volume1 : Volume2;
  return (
    <div className="d-flex align-items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label={'Mute ' + props.label}
        aria-pressed={props.muted}
        onClick={props.onMuteClick}
      >
        <Icon size={20} />
      </button>
      <input
        type="range"
        className={'volume-range' + (props.muted ? ' muted' : '')}
        aria-label={props.label + ' volume'}
        min={0}
        max={100}
        step={1}
        value={volume}
        style={{ '--fill': volume + '%' } as CSSProperties}
        onChange={(event) => props.onChange(Number(event.target.value))}
        onPointerUp={props.onChangeEnd}
        onKeyUp={props.onChangeEnd}
        onBlur={props.onChangeEnd}
      />
    </div>
  );
}
