/* All answers and matching run locally. The only remote resource is the read-only Google Sheets callback. */
(function () {
  'use strict';
  const SHEET = 'https://docs.google.com/spreadsheets/d/1balBGf8QhZ5dc-RCCAPt2kcrcf6m_YRh0HL_r8bBtJw';
  const normalize = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9€<>. ]/g, ' ').replace(/\s+/g, ' ').trim();
  const amount = v => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  const money = v => amount(v) === null ? 'Price unavailable' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(v));
  const description = v => String(v || '').split(/\bnote to (?:the )?ai\s*:/i)[0].trim();
  const fields = ['tour_id', 'tour_name', 'category', 'location', 'meeting_point', 'price_eur', 'duration_hours', 'capacity', 'availability', 'slots_this_week', 'special_offer', 'description'];
  function parseResponse(response) {
    if (response.status !== 'ok' || !response.table) throw Error('Google did not return a readable tour table.');
    const columns = response.table.cols.map(c => String(c.label || '').trim().toLowerCase());
    if (!fields.every(f => columns.includes(f))) throw Error('The sheet column names have changed. Required columns include tour_name, price_eur, availability and slots_this_week.');
    const rows = response.table.rows.map(row => Object.fromEntries(fields.map(f => {
      const cell = row.c[columns.indexOf(f)];
      return [f, cell && cell.v != null ? String(cell.v) : ''];
    }))).filter(row => row.tour_name.trim());
    if (!rows.length) throw Error('No named tours were returned by the sheet.');
    return rows;
  }
  const stop = new Set('a an the i we me you our us is it its are was be do does did can could would should please show tell about what which tours tour trip trips price prices cost costs how much for in of to and or have has this week anything all available availability slots spaces special offers under below less than up budget recommend recommendations looking want like something more information details there any from with on at best cheapest most expensive hi hello thanks thank'.split(' '));
  function answer(question, rows, context = {}) {
    const q = normalize(question);
    const result = (text, tours = [], extra = {}) => ({ text, tours, context, ...extra });
    if (/^(hi|hello|hey|good morning|good evening)[ .!]*$/.test(q)) return result('Hello! Tell me a destination, a type of tour, or a budget. For example: “Cycling tours under €60” or “What has spaces in Doolin?”');
    if (/^(thanks|thank you|cheers)[ .!]*$/.test(q)) return result('You’re welcome! What else would you like to explore?');
    if (/\b(book|reserve|reservation|pay|purchase)\b/.test(q) && !/\b(price|cost|much)\b/.test(q)) return result('I can help you explore the tour information, but I cannot make bookings or take payments. Booking instructions are not provided in this spreadsheet.');
    const missing = /\b(refund|cancel|cancellation|wheelchair|accessible|accessibility|insurance|phone|email|contact|weather|toilet|bathroom|parking fee|minimum age|age limit|pet|pets|dog friendly|pregnan|medical)\b/.test(q);
    if (missing) return result('That information is not provided in the spreadsheet’s dedicated fields. I can give you the listed description, meeting point, price, schedule, duration, capacity, weekly spaces or special offer for a tour. Please confirm any other requirements with the tour operator.');
    const exact = rows.filter(t => q.includes(normalize(t.tour_name)) || (t.tour_id && new RegExp('\\b' + normalize(t.tour_id) + '\\b').test(q)));
    let matches = exact.length ? exact : [...rows];
    let constrained = exact.length > 0;
    const followup = /\b(it|its|that|those|these|them|they|same|this tour)\b/.test(q) || /^(and |what about |how much|where do|where is|when does|how long|any offers|what is the price)/.test(q);
    if (!exact.length && followup && context.ids?.length) { matches = rows.filter(t => context.ids.includes(t.tour_id || t.tour_name)); constrained = true; }
    if (!exact.length) {
      const places = [...new Set(rows.flatMap(t => t.location.split(',').map(x => normalize(x).replace(/^co\.?\s+/, ''))).filter(Boolean))];
      const mentioned = places.filter(p => new RegExp('(?:^| )' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: |$)').test(q));
      if (mentioned.length) { matches = matches.filter(t => mentioned.every(p => normalize(t.location).includes(p))); constrained = true; }
      const groups = [[/\b(kayak\w*|paddl\w*)\b/, /kayak/], [/\b(cycl\w*|bik\w*)\b/, /cycling|cycle|bike/], [/\b(food|seafood|oyster\w*|tasting|foraging)\b/, /food/], [/\b(boat|cruise|sailing|sail)\b/, /boat|cruise|sail/], [/\b(hike|hiking|trek|trekking|cliff walks?|walking|walks?)\b/, /cliff|walk|hike|trek/], [/\b(yoga|surf|horse|segway|photograph\w*|dark sky)\b/, null]];
      for (const [pattern, category] of groups) if (pattern.test(q)) { const term = q.match(pattern)[0]; matches = matches.filter(t => category ? category.test(normalize(t.category + ' ' + t.tour_name)) : normalize(t.tour_name + ' ' + t.description).includes(term.replace(/ing$/, ''))); constrained = true; break; }
    }
    const duration = q.match(/(?:under|less than|up to|max(?:imum)?)\s*(\d+)\s*(?:hour|hr)/);
    const budget = duration ? null : q.match(/(?:under|below|less than|up to|maximum|max|budget(?: of)?)\s*(?:€|eur\s*|euros?\s*)?\s*(\d+(?:\.\d+)?)/);
    if (budget) { const exclusive = /^(under|below|less than)/.test(budget[0]); matches = matches.filter(t => amount(t.price_eur) !== null && (exclusive ? Number(t.price_eur) < Number(budget[1]) : Number(t.price_eur) <= Number(budget[1]))); constrained = true; }
    const over = q.match(/(?:over|above|more than)\s*€?\s*(\d+(?:\.\d+)?)/);
    if (over) { matches = matches.filter(t => amount(t.price_eur) !== null && Number(t.price_eur) > Number(over[1])); constrained = true; }
    if (duration) { const exclusive = /^(under|less than)/.test(duration[0]); matches = matches.filter(t => amount(t.duration_hours) !== null && (exclusive ? Number(t.duration_hours) < Number(duration[1]) : Number(t.duration_hours) <= Number(duration[1]))); constrained = true; }
    const wantsOffers = /\b(offers?|discounts?|deals?|specials?)\b/.test(q);
    if (wantsOffers) { matches = matches.filter(t => t.special_offer.trim()); constrained = true; }
    const wantsSlots = /\b(available|availability|slots|spaces|spots|places left|room left)\b/.test(q);
    const wantsFull = /\b(sold out|full|no (?:spaces|slots)|zero (?:spaces|slots))\b/.test(q);
    const party = q.match(/(?:for|group of|party of)\s*(\d+)\s*(?:people|persons|adults|friends|of us)?/);
    if (!exact.length && wantsFull) { matches = matches.filter(t => amount(t.slots_this_week) === 0); constrained = true; }
    else if (!exact.length && (wantsSlots || party)) { matches = matches.filter(t => amount(t.slots_this_week) !== null && Number(t.slots_this_week) >= (party ? Number(party[1]) : 1)); constrained = true; }
    const terms = q.split(' ').filter(t => t.length > 2 && !stop.has(t) && !/^\d/.test(t) && t !== 'eur' && t !== 'euro' && t !== 'euros');
    if (!exact.length && !followup && terms.length) {
      const scored = matches.map(t => ({ t, score: terms.reduce((n, term) => n + (normalize(t.tour_name).includes(term) ? 5 : normalize(t.location + ' ' + t.category).includes(term) ? 3 : normalize(description(t.description)).includes(term) ? 1 : 0), 0) }));
      const high = Math.max(0, ...scored.map(x => x.score));
      if (high && !budget && !wantsOffers && !wantsSlots && !party && !duration) { matches = scored.filter(x => x.score >= Math.max(1, high * .65)).sort((a, b) => b.score - a.score).map(x => x.t); constrained = true; }
      else if (!high && !constrained && !/\b(all|list|browse|recommend|cheapest|expensive|tours|destinations|schedules)\b/.test(q)) return result('I couldn’t find that information in the tour sheet. Try a tour name, a destination, “tours under €50”, “special offers”, or “cycling tours”. I won’t guess details that aren’t listed.');
    }
    if (/\b(cheapest|lowest|affordable)\b/.test(q)) matches = matches.filter(t => amount(t.price_eur) !== null).sort((a,b) => Number(a.price_eur)-Number(b.price_eur));
    if (/\b(expensive|highest)\b/.test(q)) matches = matches.filter(t => amount(t.price_eur) !== null).sort((a,b) => Number(b.price_eur)-Number(a.price_eur));
    if (!matches.length) return result('No tours match those conditions in the current sheet. Try a different destination, budget or activity. A blank field means the information is unavailable, not that the answer is zero.');
    context = { ids: matches.map(t => t.tour_id || t.tour_name) };
    const out = text => ({ text, tours: matches, context });
    const dateSpecific = /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\.\d{1,2})\b/.test(q);
    const dateNote = dateSpecific ? '\nThe sheet lists general operating schedules and weekly spaces, not date-specific departures or availability. I cannot confirm a place for that particular date.' : '';
    if (matches.length === 1) {
      const t = matches[0]; let lines = [t.tour_name];
      if (/\b(price|prices|cost|costs|much|expensive|cheap|cheapest)\b/.test(q)) lines.push('Listed price: ' + money(t.price_eur) + '.');
      else if (/\b(meet|meeting|start|where|pickup|pick up)\b/.test(q)) lines.push('Location: ' + (t.location || 'Not provided') + '.\nMeeting point: ' + (t.meeting_point || 'Not provided') + '.');
      else if (/\b(schedule|schedules|when|season|run|operat\w*|time|depart\w*)\b/.test(q)) lines.push('Operating schedule: ' + (t.availability || 'Not provided') + '. Departure times are not specified in the sheet.');
      else if (/\b(duration|long|hours?)\b/.test(q)) lines.push('Duration: ' + (t.duration_hours ? t.duration_hours + ' hours' : 'Not provided') + '.');
      else if (wantsSlots || party) lines.push('Spaces this week: ' + (t.slots_this_week || 'Not provided') + '. Group capacity: ' + (t.capacity || 'Not provided') + '. Weekly spaces do not confirm a specific departure.');
      else if (wantsOffers) lines.push('Listed offer: ' + t.special_offer + '.');
      else lines.push(description(t.description) || 'No description is provided.', 'Listed price: ' + money(t.price_eur) + '. Schedule: ' + (t.availability || 'Not provided') + '.');
      if (party && amount(t.slots_this_week) !== null && Number(t.slots_this_week) < Number(party[1])) lines.push('The sheet does not list enough weekly spaces for your group.');
      return out(lines.join('\n') + dateNote);
    }
    if (/\b(destinations|locations|where can)\b/.test(q)) return out('The sheet lists these destinations:\n' + [...new Set(matches.map(t => t.location).filter(Boolean))].sort().join('\n') + dateNote);
    let text = matches.length + ' tours match your question.';
    if (/\b(cheapest|lowest|affordable)\b/.test(q)) text = 'The lowest listed price among these tours is ' + money(matches[0].price_eur) + ' for ' + matches[0].tour_name + '. Tours below are sorted by price.';
    if (/\b(expensive|highest)\b/.test(q)) text = 'The highest listed price among these tours is ' + money(matches[0].price_eur) + ' for ' + matches[0].tour_name + '. Prices are shown exactly as listed in the price column.';
    if (/recommend/.test(q)) text += ' These suggestions match the preferences you mentioned; check the listed schedule and spaces before booking.';
    if (wantsSlots || party) text += ' Weekly spaces and operating seasons are separate: a weekly count does not confirm a date-specific departure.';
    return out(text + dateNote);
  }
  globalThis.TourBotEngine = { answer, parseResponse, normalize, money };
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const state = { rows: [], valid: false, loading: false, last: null, context: {}, sequence: 0 };
  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function timestamp() { return state.last ? state.last.toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'medium' }) : 'Never'; }
  function card(t) {
    const el = element('article', 'tour-card'); el.append(element('div', 'tour-type', t.category || 'Tour'), element('h3', '', t.tour_name), element('p', '', (t.location || 'Location unavailable') + ' · ' + (t.duration_hours ? t.duration_hours + ' hours' : 'Duration unavailable')));
    const facts = element('div', 'tour-facts'); facts.append(element('span', 'tour-price', money(t.price_eur)), element('span', 'tour-slots' + (amount(t.slots_this_week) === 0 ? ' full' : ''), amount(t.slots_this_week) === null ? 'Spaces unavailable' : Number(t.slots_this_week) === 0 ? 'Full this week' : t.slots_this_week + ' spaces this week')); el.append(facts);
    if (t.special_offer) el.append(element('p', 'tour-offer', '✦ ' + t.special_offer));
    const detail = element('details'); detail.append(element('summary', '', 'Schedule & tour details'), element('p', '', description(t.description) || 'Description not provided'), element('p', '', 'Operating schedule: ' + (t.availability || 'Not provided')), element('p', '', 'Meeting point: ' + (t.meeting_point || 'Not provided')), element('p', '', 'Group capacity: ' + (t.capacity || 'Not provided')), element('p', '', 'Tour reference: ' + (t.tour_id || 'Not provided'))); el.append(detail);
    const ask = element('button', 'ask-tour', 'Ask about this tour ↗'); ask.type = 'button'; ask.addEventListener('click', () => submit('Tell me about ' + t.tour_name)); el.append(ask); return el;
  }
  function message(text, role, tours = []) {
    const wrap = element('div', 'message ' + role); wrap.append(element('p', '', text));
    if (tours.length) {
      let shown = 0; const list = element('div'); const more = element('button', 'show-more'); more.type = 'button';
      const show = () => { const end = Math.min(shown + 5, tours.length); for (; shown < end; shown++) list.append(card(tours[shown])); more.textContent = 'Show more (' + (tours.length - shown) + ' remaining)'; more.hidden = shown >= tours.length; };
      more.addEventListener('click', show); show(); wrap.append(list, more);
    }
    if (role === 'assistant' && state.last && state.valid) wrap.append(element('p', 'answer-time', 'Source: Google Sheet · Refreshed ' + timestamp()));
    $('messages').append(wrap); $('messages').scrollTop = $('messages').scrollHeight;
  }
  function submit(q) {
    q = q.trim(); if (!q) return; message(q, 'user'); $('question').value = '';
    if (!state.valid || state.loading) { message(state.loading ? 'Please wait while I refresh the live sheet.' : 'Current tour information could not be verified. Click Refresh Data and try again. I will not answer using data from a failed refresh.', 'assistant'); return; }
    const response = answer(q, state.rows, state.context); state.context = response.context; message(response.text, 'assistant', response.tours); $('question').focus();
  }
  function renderCatalogue() {
    const q = normalize($('tour-search').value), category = $('category').value;
    const rows = state.valid ? state.rows.filter(t => (!category || category === t.category) && normalize(t.tour_name + ' ' + t.location).includes(q)) : [];
    $('catalogue').replaceChildren(...rows.map(card)); $('tour-count').textContent = state.valid ? rows.length + ' / ' + state.rows.length + ' tours' : '— tours';
    if (!rows.length) $('catalogue').append(element('p', 'empty', state.valid ? 'No tours match these filters.' : 'Live data is unavailable. Please refresh to load the tours.'));
  }
  function refresh() {
    if (state.loading) return; state.loading = true; state.valid = false; $('refresh').disabled = true; $('refresh').textContent = 'Refreshing…'; $('data-status').textContent = 'Reading the live Google Sheet…'; $('warning').hidden = true; renderCatalogue();
    const name = '__atlanticSheet' + (++state.sequence) + '_' + Date.now(); const script = document.createElement('script'); let finished = false;
    const cleanup = () => { clearTimeout(timeout); script.remove(); delete globalThis[name]; state.loading = false; $('refresh').disabled = false; $('refresh').textContent = 'Refresh Data ↻'; };
    function fail(reason) { if (finished) return; finished = true; cleanup(); state.valid = false; $('data-status').textContent = 'Refresh failed — live data unavailable'; $('warning').textContent = reason + ' Check your internet connection and try Refresh Data. The sheet and its permissions have not been changed. Tour answers are paused until a successful refresh. Earlier messages reflect their original refresh time.'; $('warning').hidden = false; $('last-refresh').textContent = 'Last successful refresh: ' + timestamp() + (state.last ? ' (not verified by this attempt).' : '.'); document.body.dataset.connection = 'failed'; renderCatalogue(); }
    const timeout = setTimeout(() => fail('Google Sheets did not respond within 20 seconds.'), 20000);
    globalThis[name] = response => { if (finished) return; try { const rows = parseResponse(response); finished = true; cleanup(); state.rows = rows; state.valid = true; state.last = new Date(); state.context = {}; const selected = $('category').value; $('category').replaceChildren(new Option('All types', ''), ...[...new Set(rows.map(t => t.category).filter(Boolean))].sort().map(c => new Option(c, c))); $('category').value = selected; $('data-status').textContent = '● Live sheet connected · ' + rows.length + ' tours'; $('last-refresh').textContent = 'Last successful refresh: ' + timestamp() + '. Google may briefly delay sheet edits.'; document.body.dataset.connection = 'ready'; document.body.dataset.tourCount = String(rows.length); renderCatalogue(); } catch (e) { fail(e.message); } };
    script.src = SHEET + '/gviz/tq?headers=1&tqx=' + encodeURIComponent('out:json;responseHandler:' + name) + '&_=' + Date.now(); script.referrerPolicy = 'no-referrer'; script.onerror = () => fail('The read-only connection to Google Sheets was blocked or unavailable.'); document.head.append(script);
  }
  $('chat-form').addEventListener('submit', event => { event.preventDefault(); submit($('question').value); });
  $('refresh').addEventListener('click', refresh); $('tour-search').addEventListener('input', renderCatalogue); $('category').addEventListener('change', renderCatalogue);
  document.querySelectorAll('.suggestions button').forEach(button => button.addEventListener('click', () => submit(button.textContent)));
  $('clear').addEventListener('click', () => { state.context = {}; $('messages').replaceChildren(); welcome(); });
  function welcome() { message('Hello there! Ready to explore the west of Ireland?\n\nAsk about a tour, destination, price, schedule or this week’s spaces. Try “Kayaking under €80”, “What’s the cheapest tour?” or “Where does the Cliffs of Moher walk meet?”\n\nUse Refresh Data after editing the sheet. I only read it; I cannot change it or take bookings.', 'assistant'); }
  welcome(); refresh();
}());
