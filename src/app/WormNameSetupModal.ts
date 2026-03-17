import type { TeamTemplate } from '../domain/config';

const normalizeName = (rawValue: string, fallback: string): string => {
  const compact = rawValue.trim().replace(/\s+/g, ' ');
  return compact.length > 0 ? compact.slice(0, 24) : fallback;
};

const normalizeController = (rawValue: string): 'human' | 'ai' =>
  rawValue === 'ai' ? 'ai' : 'human';

const cloneTeamTemplate = (team: TeamTemplate): TeamTemplate => ({
  ...team,
  worms: [...team.worms],
});

const applySessionTeams = (
  target: TeamTemplate[],
  sessionTeams: TeamTemplate[],
): void => {
  target.splice(0, target.length, ...sessionTeams.map(cloneTeamTemplate));
};

export const openWormNameSetupModal = async (
  host: HTMLElement,
  teams: TeamTemplate[],
): Promise<TeamTemplate[]> =>
  new Promise((resolve) => {
    const sourceTeams = teams.map(cloneTeamTemplate);
    const overlay = document.createElement('div');
    overlay.className = 'name-setup';

    const panel = document.createElement('form');
    panel.className = 'name-setup__panel';

    const title = document.createElement('h2');
    title.className = 'name-setup__title';
    title.textContent = 'Worm Roster Setup';
    panel.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'name-setup__subtitle';
    subtitle.textContent = 'Renomme tes worms avant de lancer le combat.';
    panel.appendChild(subtitle);

    const body = document.createElement('div');
    body.className = 'name-setup__body';
    panel.appendChild(body);

    const fields: Array<{
      input: HTMLInputElement;
      fallback: string;
      teamIndex: number;
      wormIndex: number;
    }> = [];
    const controllerFields: Array<{
      select: HTMLSelectElement;
      teamIndex: number;
    }> = [];

    sourceTeams.forEach((team, teamIndex) => {
      const section = document.createElement('section');
      section.className = 'name-setup__team';
      section.dataset.teamId = team.id;
      section.style.setProperty('--team-color', team.color);
      body.appendChild(section);

      const teamHead = document.createElement('div');
      teamHead.className = 'name-setup__team-head';
      section.appendChild(teamHead);

      const header = document.createElement('h3');
      header.className = 'name-setup__team-title';
      header.textContent = team.name;
      teamHead.appendChild(header);

      const controllerField = document.createElement('label');
      controllerField.className = 'name-setup__controller';
      teamHead.appendChild(controllerField);

      const controllerLabel = document.createElement('span');
      controllerLabel.className = 'name-setup__controller-label';
      controllerLabel.textContent = 'Controle';
      controllerField.appendChild(controllerLabel);

      const controllerSelect = document.createElement('select');
      controllerSelect.className = 'name-setup__controller-select';
      controllerSelect.id = `team-controller-${team.id}`;
      controllerSelect.setAttribute('aria-label', `Controle equipe ${team.name}`);
      controllerSelect.innerHTML = [
        '<option value="human">Joueur</option>',
        '<option value="ai">IA</option>',
      ].join('');
      controllerSelect.value = team.controller === 'ai' ? 'ai' : 'human';
      controllerField.appendChild(controllerSelect);
      controllerFields.push({ select: controllerSelect, teamIndex });

      const list = document.createElement('div');
      list.className = 'name-setup__worm-list';
      section.appendChild(list);

      team.worms.forEach((defaultName, wormIndex) => {
        const field = document.createElement('label');
        field.className = 'name-setup__field';
        list.appendChild(field);

        const fieldLabel = document.createElement('span');
        fieldLabel.className = 'name-setup__field-label';
        fieldLabel.textContent = `Worm ${wormIndex + 1}`;
        field.appendChild(fieldLabel);

        const input = document.createElement('input');
        input.className = 'name-setup__input';
        input.type = 'text';
        input.required = true;
        input.maxLength = 24;
        input.value = defaultName;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.id = `worm-name-${teamIndex}-${wormIndex}`;
        field.appendChild(input);

        fields.push({
          input,
          fallback: defaultName || `${team.name} ${wormIndex + 1}`,
          teamIndex,
          wormIndex,
        });
      });
    });

    const submit = document.createElement('button');
    submit.className = 'name-setup__submit';
    submit.type = 'submit';
    submit.textContent = 'Start Combat';
    panel.appendChild(submit);

    panel.addEventListener('submit', (event) => {
      event.preventDefault();

      const sessionTeams = sourceTeams.map(cloneTeamTemplate);
      for (const field of controllerFields) {
        const team = sessionTeams[field.teamIndex];
        if (team) {
          team.controller = normalizeController(field.select.value);
        }
      }

      for (const field of fields) {
        const team = sessionTeams[field.teamIndex];
        if (!team) {
          continue;
        }
        const nextName = normalizeName(field.input.value, field.fallback);
        field.input.value = nextName;
        team.worms[field.wormIndex] = nextName;
      }

      // Backward-compatible application to the current runtime session object.
      applySessionTeams(teams, sessionTeams);

      overlay.remove();
      resolve(sessionTeams);
    });

    overlay.appendChild(panel);
    host.appendChild(overlay);

    const firstInput = fields[0]?.input;
    if (firstInput) {
      requestAnimationFrame(() => {
        firstInput.focus();
        firstInput.select();
      });
    }
  });
