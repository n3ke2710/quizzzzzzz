import type { Team } from '../game/types';

type Props = {
  teams: Team[];
  selectedId?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  disabledIds?: string[];
  label: string;
};

const scoreFormatter = new Intl.NumberFormat('ru-RU');

export default function TeamChoices({ teams, selectedId, onSelect, disabled = false, disabledIds = [], label }: Props) {
  const unavailableIds = new Set(disabledIds);
  return <div className="team-choice-group" role="radiogroup" aria-label={label}>
    {!teams.length && <small>Сначала добавьте команды</small>}
    {teams.map(team => {
      const selected = selectedId === team.id;
      const unavailable = disabled || unavailableIds.has(team.id);
      return <button key={team.id} type="button" role="radio" aria-checked={selected} aria-label={team.name}
        disabled={unavailable} className={`team-choice${selected ? ' selected' : ''}${unavailable ? ' unavailable' : ''}`}
        onClick={() => onSelect(team.id)}>
        <span className="team-choice-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />
        <span className="team-choice-name">{team.name}</span>
        <span className="team-choice-score">{scoreFormatter.format(team.score)} очков</span>
      </button>;
    })}
  </div>;
}
