/* {{NAME_COMMENT}} — a StarNet plugin.
 *
 * THIS FILE runs in the station, in its own process, once you approve the plugin in ABILITIES → EXTENSIONS.
 * It has your computer's permissions. register(api) runs once; everything is registered inside it:
 *
 *   api.on(event, fn)      hook every run: pre_tool_call (return {decision:"block", reason} to stop a tool),
 *                          post_tool_call, pre_llm_call (return {context:"…"} to add a note), on_session_end, …
 *   api.tool({...})        a tool your crew can call. It reaches an agent when this plugin's TERMINAL stands in
 *                          that agent's room, and every call shows you an approval card.
 *   api.handle(name, fn)   answer this plugin's own window: starnet.backend.call(name, args) in ui/index.html
 *   api.every(ms, fn)      a background job (10 s minimum)
 *   api.store              the SAME storage the window uses (get / set / delete / keys)
 *
 * ui/index.html is the plugin's WINDOW: any HTML/JS you like, opened in a real StarNet window with the station
 * kit loaded (glass sn-* classes + `starnet`). docs/PLUGINS.md in the StarNet repo lists every class and call.
 * Delete this file (and "main" in plugin.json) for a window-only plugin. Any edit turns the plugin off until
 * you approve the new code.
 */
'use strict';

module.exports = {
  register(api) {
    let toolCalls = 0;

    // 1. HOOKS — watch the crew work
    api.on('post_tool_call', () => { toolCalls++; });
    api.on('on_session_end', () => { console.log('run finished after ' + toolCalls + ' tool calls'); });

    // 2. TOOLS — the crew can read and add to the notes you keep in this plugin's window
    api.tool({
      name: 'read_notes',
      description: 'Read the notes the Commander keeps in the ' + {{NAME_JSON}} + ' window, newest first.',
      readOnly: true,
      parameters: { type: 'object', properties: {} },
      run: async () => (await api.store.get('notes')) || []
    });
    api.tool({
      name: 'add_note',
      description: 'Add a note to the ' + {{NAME_JSON}} + ' window.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'the note' } }, required: ['text'] },
      run: async ({ text }) => {
        const notes = (await api.store.get('notes')) || [];
        notes.unshift({ text: String(text).slice(0, 200), at: Date.now(), by: 'crew' });
        await api.store.set('notes', notes);
        return 'Added. The window now shows ' + notes.length + ' notes.';
      }
    });

    // 3. WINDOW CALLS — ui/index.html asks: starnet.backend.call('stats')
    api.handle('stats', () => ({ toolCalls }));
  }
};
