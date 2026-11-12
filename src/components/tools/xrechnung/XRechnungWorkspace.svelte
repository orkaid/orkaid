<script lang="ts">
  // Rechnungsblatt (MDR-46): the invoice sheet is the form. Every value on the sheet is the field itself; the block being
  // worked in shows the tools of editing, a resting block reads as the document. Every amount and diagnostic is the domain's.
  import { tick, type ComponentProps, type Snippet } from 'svelte';
  import { formatLocalizedDecimal } from '../../../lib/domain/xrechnung/number-notation.ts';
  import { copy, describeError, fill, openCountText } from '../../../i18n/xrechnung.ts';
  import type { HelpId } from '../../../i18n/xrechnung-help.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Field from './Field.svelte';
  import Glyph from './Glyph.svelte';
  import HelpDrawer from './HelpDrawer.svelte';
  import LinesEditor from './LinesEditor.svelte';
  import ScopeNote from './ScopeNote.svelte';
  import { activeFixedReasons, checkForm, countByKind, exportXml, fieldValues, hasReverseCharge, previewTotals, sectionOf, type DiagnosticItem, type ExportFormat, type SectionId } from './form-adapter.ts';
  import { emptyFormState, FIELD_IDS, type FieldId } from './form-state.ts';
  import { returnTarget } from './focus-return.ts';

  type Status = 'pristine' | 'incomplete' | 'invalid' | 'local';
  type SectionState = { id: SectionId; kind: 'ok' | 'error' | 'incomplete' | 'pending'; text: string };
  type FieldOpts = Partial<Pick<ComponentProps<typeof Field>, 'kind' | 'plain' | 'title' | 'required' | 'optionalMark' | 'markText' | 'keep' | 'options' | 'helpId' | 'hint' | 'describedById' | 'inputmode' | 'autocomplete' | 'rows'>>;
  // Reading order of a real invoice: issuer, document data, recipient, lines, payment, notes.
  const SHEET: readonly SectionId[] = ['seller', 'document', 'buyer', 'lines', 'payment', 'notes'];

  let { locale }: { locale: Locale } = $props();

  const form = $state(emptyFormState());
  const initial = JSON.stringify(emptyFormState());
  let touched = $state<Record<string, boolean>>({});
  let checked = $state(false);
  let lastExport = $state<{ format: ExportFormat; time: string; snapshot: string } | undefined>();
  let exportFailure = $state<string | undefined>();
  let announcement = $state('');
  let open = $state<SectionId | undefined>();
  let menu = $state(false);
  let cursor: string | undefined;
  let drawer: HelpDrawer | undefined = $state();
  let statusEl: HTMLElement | undefined = $state();

  // The domain answers on every change: full validation, and the lines-only preview for the totals.
  const result = $derived(checkForm(form));
  const items = $derived<readonly DiagnosticItem[]>(result.ok ? [] : result.items);
  const truncated = $derived(!result.ok && result.truncated);
  const counts = $derived(countByKind(items));
  const preview = $derived(previewTotals(form));
  const totals = $derived(result.ok ? result.invoice.totals : preview.ok ? preview.totals : undefined);
  const snapshot = $derived(JSON.stringify(form));
  const status = $derived<Status>(
    snapshot === initial && !checked ? 'pristine' : counts.invalid + counts.internal > 0 ? 'invalid' : counts.missing > 0 ? 'incomplete' : 'local',
  );
  const changedSinceExport = $derived(lastExport !== undefined && lastExport.snapshot !== snapshot);
  const statusLine = $derived(status === 'pristine' ? copy['status.pristine'][locale] : status === 'local' ? copy['status.local'][locale] : openCountText(counts.missing, counts.invalid + counts.internal, locale));
  const statusGlyph = $derived(status === 'local' ? 'ok' : status === 'invalid' ? 'error' : status === 'incomplete' ? 'incomplete' : 'pending');
  const openTotal = $derived(counts.missing + counts.invalid + counts.internal);
  const stamp = $derived(status === 'local' ? copy['sheet.stampReady'][locale] : status === 'pristine' ? copy['sheet.stampDraft'][locale] : fill(copy['sheet.stampOpen'][locale], { n: openTotal }));

  const values = $derived(fieldValues(form));
  // An empty field is "missing", whatever code the monetary part of the domain answers for it; the code itself is untouched.
  const itemText = (item: DiagnosticItem): string =>
    item.kind === 'internal' ? fill(copy['diag.internal'][locale], { code: item.code })
    : item.kind === 'missing' && item.fieldId === item.path && item.code !== 'unsupported_vat_rate' ? describeError('missing_field', item.path, locale)
    : describeError(item.code, item.path, locale);
  // A message appears once its field was left, or after an explicit check, which marks every open path of that moment.
  // A line added afterwards is therefore not marked before the user has touched it; the counts are always live.
  const shown = $derived.by(() => {
    const map: Record<string, { text: string; missing: boolean }> = {};
    for (const item of items) {
      if (item.fieldId !== item.path || item.kind === 'internal') continue;
      if (touched[item.path]) map[item.path] = { text: itemText(item), missing: item.kind === 'missing' };
    }
    return map;
  });
  const errorFor = (id: string): string | undefined => shown[id]?.text;
  const isMissing = (id: string): boolean => shown[id]?.missing === true;
  const touch = (id: string): void => { touched[id] = true; };
  /** True while the domain reports this group-level requirement as open (never decided here). */
  const has = (code: string): boolean => items.some((item) => item.code === code);
  const groupError = (code: string, path: string, members: readonly string[] = []): string | undefined => {
    if (!touched[path] && !members.some((id) => touched[id])) return undefined;
    const item = items.find((entry) => entry.code === code && entry.path === path);
    return item ? describeError(item.code, item.path, locale) : undefined;
  };
  const hasValues = (section: SectionId): boolean => Object.entries(values).some(([path, value]) => value !== '' && sectionOf(path) === section);
  // Quiet until the user has begun a section: a neutral count instead of a warning nobody has earned yet.
  const sectionState = (section: SectionId): SectionState => {
    const c = countByKind(items.filter((item) => item.section === section));
    const errors = c.invalid + c.internal;
    if (errors > 0) return { id: section, kind: 'error', text: fill(copy.secErrors[locale], { n: errors }) + (c.missing > 0 ? `, ${fill(copy.secOpen[locale], { n: c.missing })}` : '') };
    if (c.missing > 0) return checked || hasValues(section) ? { id: section, kind: 'incomplete', text: fill(copy.secOpen[locale], { n: c.missing }) } : { id: section, kind: 'pending', text: fill(copy['sheet.secTodo'][locale], { n: c.missing }) };
    return hasValues(section) ? { id: section, kind: 'ok', text: copy['sheet.secDone'][locale] } : { id: section, kind: 'pending', text: copy.optional[locale] };
  };
  const sections = $derived(Object.fromEntries(SHEET.map((id) => [id, sectionState(id)])) as Record<SectionId, SectionState>);
  // The domain's own net of one line taken alone, for display while invoice totals are unavailable. Never summed here.
  const netFor = (index: number): string | undefined => {
    const line = form.lines[index];
    if (!line) return undefined;
    const single = previewTotals({ ...form, lines: [line] });
    return single.ok && single.totals.lines[0] ? formatLocalizedDecimal(single.totals.lines[0].netAmount, 'de') : undefined;
  };
  const totalsNote = $derived.by(() => {
    const blocking = [...new Set(items.flatMap((item) => { const hit = /^lines\[(\d+)\]\.(quantity|unitPrice|vat\.rate)$/.exec(item.path); return hit ? [Number(hit[1]) + 1] : []; }))];
    if (blocking.length === 0) return copy['rail.noAmounts'][locale];
    return fill((blocking.length === 1 ? copy['sheet.linesBlockingOne'] : copy['sheet.linesBlockingMany'])[locale], { list: blocking.join(', ') });
  });
  // Rows are addressed by index: after an insertion or removal, what was known about the rows from there on no longer fits.
  function shiftLines(index: number): void {
    for (const key of Object.keys(touched)) { const hit = /^lines\[(\d+)\]/.exec(key); if (hit && Number(hit[1]) >= index) delete touched[key]; }
  }

  $effect(() => {
    const text = status === 'pristine' ? '' : statusLine;
    const timer = setTimeout(() => { announcement = text; }, 800);
    return () => clearTimeout(timer);
  });

  const rank = (id: string): number => {
    const line = /^lines\[(\d+)\]\.(.+)$/.exec(id);
    const within = line ? Number(line[1]) * 10 + ['name', 'quantity', 'unitCode', 'unitPrice', 'vat.rate'].indexOf(line[2] ?? '') : (FIELD_IDS as readonly string[]).indexOf(id);
    return SHEET.indexOf(sectionOf(id) as SectionId) * 10000 + within;
  };
  const openPoints = $derived([...new Set(items.flatMap((item) => (item.fieldId === undefined ? [] : [item.fieldId])))].sort((a, b) => rank(a) - rank(b)));

  /** A section the user has worked in shows what it still needs once they move on. An untouched one stays quiet. */
  function settle(section: SectionId | undefined): void {
    if (section === undefined || !hasValues(section)) return;
    for (const item of items) if (item.section === section) touched[item.path] = true;
  }
  /** Makes `section` the block being worked in. `anchor` keeps its place on screen while the block left behind folds. */
  async function activate(section: SectionId, anchor?: Element | null): Promise<void> {
    if (open === section) return;
    const before = anchor?.getBoundingClientRect().top;
    settle(open);
    open = section;
    await tick();
    if (anchor && before !== undefined) {
      const delta = anchor.getBoundingClientRect().top - before;
      if (delta !== 0) scrollBy({ top: delta, behavior: 'instant' });
    }
  }
  const usable = (element: HTMLElement): boolean => element.isConnected && element.getClientRects().length > 0;
  function closeBlock(focusHeading = false): void {
    const section = open;
    if (section === undefined) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inside = focused !== null && document.getElementById(`section-${section}`)?.contains(focused) === true;
    settle(section);
    open = undefined;
    // At rest a block hides its help, hints and empty optional fields. Focus inside the block must not stay on, or vanish
    // with, what was hidden: it goes to the block heading. Focus that the caller has meanwhile moved elsewhere is left alone.
    if (focusHeading || inside) {
      void tick().then(() => {
        const heading = document.getElementById(`h-${section}`);
        const active = document.activeElement;
        const lost = active === null || active === document.body || (active === focused && focused !== null && !usable(focused));
        if (focusHeading) heading?.focus();
        else if (lost) returnTarget([focused, heading], usable)?.focus();
      });
    }
  }
  const calm = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  async function goTo(id: string): Promise<void> {
    const section = sectionOf(id);
    cursor = id;
    menu = false;
    if (section !== 'general' && open !== section) { settle(open); open = section; }
    await tick();
    const element = document.getElementById(id);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center', behavior: calm() });
  }
  function jump(section: SectionId): void {
    menu = false;
    const heading = document.getElementById(`h-${section}`);
    heading?.focus({ preventScroll: true });
    document.getElementById(`section-${section}`)?.scrollIntoView({ block: 'start', behavior: calm() });
  }
  /** The next open point after `from` in sheet order (wrapping), or the status line when nothing is open. */
  function nextOpen(from: string | undefined = cursor): void {
    const points = openPoints.filter((id) => id !== from);
    const target = points.find((id) => from === undefined || rank(id) > rank(from)) ?? points[0] ?? openPoints[0];
    if (target === undefined) { announcement = copy['sheet.allDone'][locale]; closeBlock(); statusEl?.focus(); return; }
    void goTo(target);
  }
  async function showResults(): Promise<void> {
    checked = true;
    for (const item of items) touched[item.path] = true;
    open = undefined; menu = false; cursor = undefined;
    await tick();
    statusEl?.focus();
  }

  function download(xml: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function runExport(format: ExportFormat): void {
    exportFailure = undefined;
    // Always rebuilt from the current form: never an earlier XML.
    const out = exportXml(form, format);
    if (!out.ok) {
      if (out.reason === 'serializer') exportFailure = out.code;
      void showResults();
      return;
    }
    download(out.xml, out.fileName);
    const time = new Date().toLocaleTimeString(locale === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    lastExport = { format, time, snapshot };
    announcement = fill(copy['status.generated'][locale], { format: format.toUpperCase(), time });
  }
  function openHelp(id: HelpId, from: HTMLElement | null): void {
    drawer?.open(id, from);
  }
  function onKey(event: KeyboardEvent): void {
    const target = event.target;
    // Enter in a one-line field moves on to the next open point: the sheet is filled without hunting for fields. Never while
    // an IME composition is being confirmed, and never on selects, text areas, buttons or other controls (their native Enter).
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && target instanceof HTMLInputElement && target.type === 'text') { event.preventDefault(); touch(target.id); nextOpen(target.id); }
    else if (event.key === 'Escape' && menu) { menu = false; document.getElementById('bar-menu')?.focus(); }
    else if (event.key === 'Escape' && open !== undefined && target instanceof Element && target.closest('.blk')) closeBlock(true);
  }

  const money = (value: { units: bigint; scale: number }) => `${formatLocalizedDecimal(value, 'de')} EUR`;
  const meansOptions = [{ value: '30', label: copy.means30[locale] }, { value: '58', label: copy.means58[locale] }];
  const schemeOptions = [
    { value: 'EM', label: copy.schemeEM[locale] },
    { value: '0204', label: copy.scheme0204[locale] },
    { value: '0088', label: copy.scheme0088[locale] },
  ];
  const f = form.fields;
  const reasons = $derived(activeFixedReasons(form));
  const buyerNeedsId = $derived(hasReverseCharge(form));
  const oneOf = copy['sheet.oneOf'][locale];
</script>

{#snippet fld(id: FieldId, key: keyof typeof copy, o: FieldOpts = {})}
  <Field {id} {locale} label={copy[key][locale]} bind:value={f[id]} error={errorFor(id)} missing={isMissing(id)} onblur={() => touch(id)} onmore={(el) => { if (o.helpId) openHelp(o.helpId, el); }} {...o} />
{/snippet}
{#snippet alert(text: string | undefined)}
  {#if text}<p class="group-error" role="alert"><Glyph kind="error" /> {text}</p>{/if}
{/snippet}
{#snippet party(side: 'seller' | 'buyer')}
  {@render fld(`${side}.name`, 'f.name', { required: true, plain: true, title: true })}
  {@render fld(`${side}.address.street`, 'f.street', { required: true, plain: true })}
  <div class="zipcity">
    {@render fld(`${side}.address.postCode`, 'f.postCode', { required: true, plain: true })}
    {@render fld(`${side}.address.city`, 'f.city', { required: true, plain: true })}
  </div>
  <p class="country">{copy.fixedDE[locale]}</p>
{/snippet}

{#snippet bodySeller()}
  {@render party('seller')}
  {@render fld('seller.contact.name', 'f.contactName', { required: true, autocomplete: 'name', helpId: 'sellerContact' })}
  {@render fld('seller.contact.telephone', 'f.contactTelephone', { required: true, inputmode: 'tel', autocomplete: 'tel' })}
  {@render fld('seller.contact.email', 'f.contactEmail', { required: true, inputmode: 'email', autocomplete: 'email' })}
  {@render fld('seller.electronicAddress.schemeId', 'f.schemeId', { required: true, kind: 'select', options: schemeOptions, helpId: 'electronicAddress', hint: copy.schemeHint[locale] })}
  {@render fld('seller.electronicAddress.value', 'f.addressValue', { required: true })}
  <fieldset class="grp">
    <legend>{copy['grp.sellerTax'][locale]}</legend>
    <p class="group-hint">{copy['grp.sellerTaxHint'][locale]}</p>
    {@render alert(groupError('missing_seller_tax_identifier', 'seller', ['seller.vatId', 'seller.taxRegistrationId']))}
    {@render fld('seller.vatId', 'f.vatId', { optionalMark: true, markText: oneOf, keep: has('missing_seller_tax_identifier'), helpId: 'sellerVatId' })}
    {@render fld('seller.taxRegistrationId', 'f.taxRegistrationId', { optionalMark: true, markText: oneOf, keep: has('missing_seller_tax_identifier'), helpId: 'sellerTaxNumber' })}
  </fieldset>
  <fieldset class="grp">
    <legend>{copy['grp.sellerId'][locale]}</legend>
    {@render alert(groupError('missing_seller_identification', 'seller'))}
    {@render fld('seller.legalRegistrationId', 'f.legalRegistrationId', { optionalMark: true, helpId: 'sellerIdentification' })}
    {@render fld('seller.sellerIdentifiers[0]', 'f.sellerIdentifier', { optionalMark: true })}
  </fieldset>
{/snippet}

{#snippet bodyDocument()}
  {@render fld('invoiceNumber', 'f.invoiceNumber', { required: true })}
  {@render fld('issueDate', 'f.issueDate', { required: true, kind: 'date' })}
  <fieldset class="grp" aria-describedby="supply-hint">
    <legend>{copy['grp.supply'][locale]}</legend>
    <p class="group-hint" id="supply-hint">{copy['grp.supplyHint'][locale]}</p>
    <div class="choices">
      <label class="choice"><input type="radio" name="supplyMode" value="date" bind:group={form.supplyMode} /> {copy['supply.date'][locale]}</label>
      <label class="choice"><input type="radio" name="supplyMode" value="period" bind:group={form.supplyMode} /> {copy['supply.period'][locale]}</label>
    </div>
    {#if form.supplyMode === 'date'}
      {@render fld('deliveryDate', 'f.deliveryDate', { required: true, kind: 'date', helpId: 'deliveryDate' })}
    {:else}
      {@render fld('invoicingPeriod.startDate', 'f.periodStart', { required: true, kind: 'date', helpId: 'invoicingPeriod' })}
      {@render fld('invoicingPeriod.endDate', 'f.periodEnd', { required: true, kind: 'date' })}
    {/if}
  </fieldset>
  {@render fld('buyerReference', 'f.buyerReference', { required: true, helpId: 'buyerReference' })}
  <div class="leitweg">
    <label class="choice"><input id="leitwegCheck" type="checkbox" bind:checked={form.leitwegCheck} aria-describedby="leitweg-note" onchange={() => { if (form.leitwegCheck && f.buyerReference !== '') touch('buyerReference'); }} /> {copy.leitwegCheck[locale]}</label>
    <button type="button" class="sec-help" aria-label={fill(copy.helpFor[locale], { field: copy.leitwegCheck[locale] })} onclick={(event) => openHelp('leitwegCheck', event.currentTarget)}>?</button>
    <p class="group-hint" id="leitweg-note">{copy.leitwegNote[locale]}</p>
  </div>
  <fieldset class="grp">
    <legend>{copy['grp.references'][locale]}</legend>
    <p class="group-hint">{copy['grp.referencesHint'][locale]}</p>
    {@render fld('projectReference', 'f.projectReference', { optionalMark: true, helpId: 'references' })}
    {@render fld('contractReference', 'f.contractReference', { optionalMark: true, helpId: 'references' })}
    {@render fld('orderReference', 'f.orderReference', { optionalMark: true, helpId: 'references' })}
  </fieldset>
{/snippet}

{#snippet bodyBuyer()}
  {@render party('buyer')}
  {@render fld('buyer.electronicAddress.schemeId', 'f.schemeId', { required: true, kind: 'select', options: schemeOptions, helpId: 'electronicAddress', hint: copy.schemeHint[locale] })}
  {@render fld('buyer.electronicAddress.value', 'f.addressValue', { required: true })}
  <fieldset class="grp" class:need={has('missing_buyer_identifier')}>
    <legend>{copy['grp.buyerId'][locale]}</legend>
    <p class="group-hint" class:active={buyerNeedsId} id="buyer-id-hint">{buyerNeedsId ? copy['grp.buyerIdHintRc'][locale] : copy['grp.buyerIdHint'][locale]}</p>
    {@render alert(groupError('missing_buyer_identifier', 'buyer', ['buyer.vatId', 'buyer.legalRegistrationId']))}
    <Field id="buyer.vatId" {locale} label={copy['f.vatId'][locale]} optionalMark describedById="buyer-id-hint" markText={buyerNeedsId ? oneOf : undefined} keep={has('missing_buyer_identifier')} bind:value={f['buyer.vatId']} helpId="buyerIdentification" error={errorFor('buyer.vatId')} missing={isMissing('buyer.vatId')} onblur={() => touch('buyer.vatId')} onmore={(el) => openHelp('buyerIdentification', el)} />
    <Field id="buyer.legalRegistrationId" {locale} label={copy['f.legalRegistrationId'][locale]} optionalMark describedById="buyer-id-hint" markText={buyerNeedsId ? oneOf : undefined} keep={has('missing_buyer_identifier')} bind:value={f['buyer.legalRegistrationId']} error={errorFor('buyer.legalRegistrationId')} missing={isMissing('buyer.legalRegistrationId')} onblur={() => touch('buyer.legalRegistrationId')} />
  </fieldset>
{/snippet}

{#snippet bodyLines()}
  <fieldset class="grp regime" aria-describedby="vat-regime-hint">
    <legend>{copy['vatRegime.legend'][locale]}</legend>
    <p class="group-hint" id="vat-regime-hint">{copy['vatRegime.hint'][locale]}</p>
    <div class="choices">
      <label class="choice"><input id="vatRegime.regular" type="radio" name="vatRegime" value="regular" bind:group={form.vatRegime} /> {copy['vatRegime.regular'][locale]}</label>
      <label class="choice"><input id="vatRegime.kleinunternehmer" type="radio" name="vatRegime" value="kleinunternehmer" bind:group={form.vatRegime} /> {copy['vatRegime.kleinunternehmer'][locale]}</label>
      <button type="button" class="sec-help" aria-label={fill(copy.helpFor[locale], { field: copy['vatRegime.legend'][locale] })} onclick={(event) => openHelp('vatRegime', event.currentTarget)}>?</button>
    </div>
    {#if form.vatRegime === 'kleinunternehmer'}<p class="group-hint">{copy['vatRegime.kuSellerHint'][locale]}</p>{/if}
  </fieldset>
  <LinesEditor bind:lines={form.lines} {locale} {totals} calculated={result.ok} {netFor} {totalsNote} {errorFor} {isMissing} {touch} onshift={shiftLines} onmore={(id, el) => openHelp(id, el)} groupError={groupError('no_lines', 'lines')} regime={form.vatRegime} />
  {#if reasons.length > 0}
    <section class="reasons" aria-labelledby="reasons-title">
      <h3 id="reasons-title">{copy['reason.title'][locale]}</h3>
      <dl>
        {#each reasons as reason (reason.treatment)}
          <div>
            <dt>{reason.treatment === 'kleinunternehmer' ? copy['vatRegime.kleinunternehmer'][locale] : copy['vat.reverseCharge'][locale]}</dt>
            <dd><q lang="de">{reason.text}</q> <span class="reason-terms">{reason.treatment === 'kleinunternehmer' ? copy['reason.ku'][locale] : copy['reason.rc'][locale]}</span></dd>
          </div>
        {/each}
      </dl>
    </section>
  {/if}
{/snippet}

{#snippet bodyPayment()}
  {@render fld('payment.means.code', 'f.meansCode', { required: true, kind: 'select', options: meansOptions, helpId: 'paymentMeans', hint: copy.meansHint[locale] })}
  {@render fld('payment.means.account.id.value', 'f.iban', { required: true, helpId: 'iban', hint: copy.ibanHint[locale] })}
  {@render fld('payment.means.account.name', 'f.accountName', { optionalMark: true })}
  {@render fld('payment.means.account.bic', 'f.bic', { optionalMark: true, helpId: 'bic' })}
  <fieldset class="grp">
    <legend>{copy['grp.paymentDue'][locale]}</legend>
    <p class="group-hint">{copy['grp.paymentDueHint'][locale]}</p>
    {@render alert(groupError('missing_payment_due_information', 'payment', ['payment.dueDate', 'payment.termsText']))}
    {@render fld('payment.dueDate', 'f.dueDate', { optionalMark: true, markText: oneOf, keep: has('missing_payment_due_information'), kind: 'date', helpId: 'paymentDue' })}
    {@render fld('payment.termsText', 'f.termsText', { optionalMark: true, markText: oneOf, keep: has('missing_payment_due_information'), kind: 'textarea' })}
  </fieldset>
{/snippet}

{#snippet bodyNotes()}
  {@render fld('notes[0].text', 'f.note', { optionalMark: true, keep: true, kind: 'textarea', plain: true, rows: 2 })}
{/snippet}

{#snippet block(id: SectionId, helpId: HelpId | undefined, body: Snippet)}
  {@const state = sections[id]}
  {@const name = copy[`sec.${id}`][locale]}
  {@const on = open === id}
  {@const nextId = SHEET[SHEET.indexOf(id) + 1]}
  <!-- Focus or a click anywhere in the block makes it the one being worked in; nothing has to be "opened" first. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    class={`blk b-${id}`} class:on id={`section-${id}`} aria-labelledby={`h-${id}`}
    onfocusin={(event) => { if (!(event.target instanceof HTMLHeadingElement)) void activate(id, event.target instanceof Element ? event.target : null); }}
    onpointerdown={(event) => { if (!on) void activate(id, event.target instanceof Element ? event.target : null); }}
  >
    <div class="blk-head">
      <h2 id={`h-${id}`} tabindex="-1">{name}</h2>
      {#if helpId && on}<button type="button" class="sec-help" aria-label={fill(copy.helpFor[locale], { field: name })} onclick={(event) => openHelp(helpId, event.currentTarget)}>?</button>{/if}
      <span class={`chip ${state.kind}`}><Glyph kind={state.kind} /> {state.text}</span>
    </div>
    <div class="blk-body">{@render body()}</div>
    {#if on}
      <div class="blk-foot">
        <button type="button" class="btn" onclick={() => closeBlock(true)}>{copy['sheet.done'][locale]}</button>
        {#if nextId}<button type="button" class="btn" onclick={() => { const first = document.querySelector<HTMLElement>(`#section-${nextId} :is(input, select, textarea)`); first?.focus(); }}>{fill(copy['sheet.nextBlock'][locale], { section: copy[`sheet.short_${nextId}`][locale] })} <span aria-hidden="true">→</span></button>{/if}
        <span class="keys">{copy['sheet.keys'][locale]}</span>
      </div>
    {/if}
  </section>
{/snippet}

<form class="desk" novalidate onsubmit={(event) => event.preventDefault()} onkeydown={onKey}>
  <div class="bar" role="region" aria-label={copy['sheet.barLabel'][locale]}>
    <div class="bar-main">
      <p class={`bar-status ${status}`} tabindex="-1" bind:this={statusEl}><Glyph kind={statusGlyph} /> <strong>{statusLine}</strong></p>
      <p class="bar-gross"><span class="lbl">{copy['rail.gross'][locale]} · {totals ? (result.ok ? copy['rail.calculated'][locale] : copy['rail.preview'][locale]) : copy['sheet.totalsNone'][locale]}</span> <span class="amt">{totals ? money(totals.totalWithVat) : '—'}</span></p>
      <button type="button" class="act next" aria-disabled={openPoints.length === 0} onclick={() => nextOpen()}>
        {#if openPoints.length === 0}{copy['sheet.allDone'][locale]}
        {:else if status === 'pristine'}{copy['sheet.begin'][locale]} <span aria-hidden="true">→</span>
        {:else}<span class="long">{copy['sheet.nextOpen'][locale]}</span><span class="short">{copy['sheet.nextShort'][locale]}</span>&nbsp;({openPoints.length}) <span aria-hidden="true">→</span>{/if}
      </button>
      <button type="button" class="act menu" id="bar-menu" aria-expanded={menu} aria-controls="bar-more" onclick={() => (menu = !menu)}>{copy['sheet.menu'][locale]} <span aria-hidden="true">{menu ? '▾' : '▴'}</span></button>
    </div>
    <div class="bar-more" id="bar-more" class:shown={menu}>
      <div class="bar-actions">
        <button type="button" class="act check" onclick={() => void showResults()}>{copy['sheet.checkLong'][locale]}</button>
        <button type="button" class="act primary" aria-disabled={!result.ok} aria-label={copy['export.ubl'][locale]} onclick={() => runExport('ubl')}>UBL 2.1 XML <span aria-hidden="true">↓</span></button>
        <button type="button" class="act primary" aria-disabled={!result.ok} aria-label={copy['export.cii'][locale]} onclick={() => runExport('cii')}>CII XML <span aria-hidden="true">↓</span></button>
      </div>
      <nav class="outline" aria-label={copy['sheet.outline'][locale]}>
        <ol>
          {#each SHEET as id (id)}
            {@const state = sections[id]}
            <li><a class={state.kind} class:here={open === id} href={`#section-${id}`} onclick={(event) => { event.preventDefault(); jump(id); }}><Glyph kind={state.kind} /> <span class="o-name">{copy[`sheet.short_${id}`][locale]}</span>{#if state.kind === 'error' || state.kind === 'incomplete'}<span class="o-count">{state.text}</span>{/if}</a></li>
          {/each}
        </ol>
      </nav>
      {#if lastExport && !changedSinceExport}<p class="bar-note"><Glyph kind="ok" /> {fill(copy['status.generated'][locale], { format: lastExport.format.toUpperCase(), time: lastExport.time })}</p>{/if}
      {#if lastExport && changedSinceExport}<p class="bar-note"><Glyph kind="info" /> {copy['status.changed'][locale]}</p>{/if}
      {#if exportFailure}<p class="bar-note danger"><Glyph kind="error" /> {fill(copy['diag.internal'][locale], { code: exportFailure })}</p>{/if}
      {#if truncated}<p class="bar-note">{copy['diag.truncated'][locale]}</p>{/if}
      {#each items.filter((item) => item.section === 'general') as item (item.code)}<p class="bar-note danger"><Glyph kind="error" /> {itemText(item)}</p>{/each}
    </div>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet" onpointerdown={(event) => { if (event.target instanceof Element && !event.target.closest('.blk')) closeBlock(); }}>
    <header class="sheet-top">
      <p class="sheet-title">{copy['sheet.sheetTitle'][locale]} <span class="sheet-no">{f.invoiceNumber}</span></p>
      <p class={`stamp ${status}`}>{stamp}</p>
      <p class="sheet-meta">{copy['sheet.sheetMeta'][locale]}</p>
    </header>
    {#if status === 'pristine'}<p class="intro">{copy['sheet.intro'][locale]}</p>{/if}
    <div class="sheet-grid">
      {@render block('seller', 'sec.seller', bodySeller)}
      {@render block('document', undefined, bodyDocument)}
      {@render block('buyer', 'sec.buyer', bodyBuyer)}
      {@render block('lines', 'sec.lines', bodyLines)}
      {@render block('payment', 'sec.payment', bodyPayment)}
      {@render block('notes', undefined, bodyNotes)}
    </div>
    <p class="notice"><Glyph kind="info" /> {copy['notice.external'][locale]} {copy['export.hint'][locale]}</p>
  </div>

  <ScopeNote {locale} />
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
</form>

<HelpDrawer bind:this={drawer} {locale} onjump={(id) => void goTo(id)} />

<style>
  .desk { display: flex; flex-direction: column; gap: var(--space-2); padding-block: 0 var(--space-4); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* Command bar: where the document stands, the way to the next open point, check and export. */
  .bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 1rem; padding-block: 0.5rem 0.375rem; background: var(--paper); border-block: 1px solid var(--ink); }
  .bar-main, .bar-more { display: contents; }
  .bar-status { flex: 1 1 14rem; display: flex; gap: 0.5rem; align-items: center; margin: 0; padding-inline-start: 0.5rem; border-inline-start: 3px solid var(--ink); font-size: 0.9375rem; line-height: 1.3; }
  .bar-status.local { border-inline-start-color: var(--accent); }
  .bar-status.invalid { border-inline-start-color: var(--danger); }
  .bar-status.pristine strong { font-weight: 400; color: var(--muted); }
  .bar-gross { display: flex; flex-direction: column; align-items: flex-end; margin: 0; }
  .lbl { color: var(--muted); font: 500 0.6875rem/1.3 var(--mono); letter-spacing: 0.04em; }
  .amt { font: 500 1.25rem/1.2 var(--mono); font-variant-numeric: tabular-nums; }
  .bar-actions { display: flex; gap: 0.5rem; }
  .act { min-height: 2.5rem; padding: 0.4rem 0.75rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font: 500 0.875rem var(--sans); cursor: pointer; white-space: nowrap; }
  .act.next { background: var(--highlight); }
  .act.primary { background: var(--ink); color: var(--paper); }
  .act[aria-disabled='true'] { background: var(--paper); color: var(--muted); border-style: dashed; border-color: var(--muted); }
  .act .short, .act.menu { display: none; }
  .outline { flex: 1 1 100%; }
  .outline ol { display: flex; flex-wrap: wrap; gap: 0 1.25rem; margin: 0; padding: 0; list-style: none; }
  .outline a { display: inline-flex; align-items: center; gap: 0.375rem; min-block-size: 1.75rem; color: var(--ink); font: 500 0.75rem/1.3 var(--mono); letter-spacing: 0.02em; text-decoration: none; border-bottom: 2px solid transparent; }
  .outline a:hover, .outline a.here { border-bottom-color: var(--accent); }
  .outline a.pending { color: var(--muted); }
  .o-count { padding: 0 0.375rem; background: var(--highlight); font-weight: 400; }
  .outline a.error .o-count { background: none; color: var(--danger); font-weight: 500; }
  .bar-note { flex: 1 1 100%; display: flex; gap: 0.5rem; margin: 0; font-size: 0.8125rem; }
  .bar-note.danger { color: var(--danger); font-weight: 500; }

  /* The sheet. */
  .sheet { container-type: inline-size; overflow-anchor: none; inline-size: 100%; padding: clamp(1rem, 3.5vw, 3rem); padding-block-start: clamp(1rem, 2.5vw, 2rem); border: 1px solid var(--ink); border-top-width: 0.375rem; box-shadow: 0.375rem 0.375rem 0 var(--rule); background: var(--paper); }
  .sheet-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.25rem 1rem; padding-block-end: 0.875rem; border-bottom: 1px solid var(--ink); }
  .sheet-title { margin: 0; font: 600 clamp(1.75rem, 4vw, 2.5rem)/1.1 var(--serif); letter-spacing: -0.01em; }
  .sheet-no { margin-inline-start: 0.5rem; font: 400 1rem var(--mono); letter-spacing: 0; overflow-wrap: anywhere; }
  .sheet-meta { grid-column: 1 / -1; margin: 0; color: var(--muted); font: 500 0.75rem var(--mono); letter-spacing: 0.04em; }
  .stamp { margin: 0; padding: 0.2rem 0.625rem; border: 1px solid var(--ink); font: 500 0.6875rem/1.5 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
  .stamp.pristine { border-style: dashed; border-color: var(--muted); color: var(--muted); }
  .stamp.incomplete { background: var(--highlight); }
  .stamp.invalid { border-color: var(--danger); color: var(--danger); }
  .stamp.local { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .intro { margin: 0.875rem 0 0; padding: 0.5rem 0.75rem; max-inline-size: 70ch; border-inline-start: 3px solid var(--accent); font-size: 0.9375rem; }
  .sheet-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 3rem; }

  .blk { min-width: 0; margin-inline-start: -0.875rem; padding: 0.875rem 0 1.125rem calc(0.875rem - 3px); border-inline-start: 3px solid transparent; border-bottom: 1px solid var(--rule); transition: border-color 0.15s; }
  .blk.on { border-inline-start-color: var(--accent); }
  .blk-head { display: flex; align-items: center; gap: 0.375rem 0.625rem; min-block-size: 1.75rem; margin-block-end: 0.375rem; }
  h2 { margin: 0; min-width: 0; color: var(--muted); font: 500 0.75rem/1.3 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; }
  .blk.on h2 { color: var(--ink); }
  .chip { flex: none; display: inline-flex; gap: 0.375rem; align-items: center; margin-inline-start: auto; padding: 0.05rem 0.5rem; font: 500 0.6875rem/1.5 var(--mono); white-space: nowrap; }
  .chip.incomplete { background: var(--highlight); }
  .chip.error { color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
  .chip.pending { color: var(--muted); }
  .chip.pending :global(svg) { display: none; }
  .sec-help { flex: none; inline-size: 1.375rem; block-size: 1.375rem; padding: 0; border: 1px solid var(--muted); border-radius: 50%; background: var(--paper); color: var(--ink); font: 500 0.6875rem/1 var(--mono); cursor: pointer; }
  .blk-body { container: blk / inline-size; display: flex; flex-direction: column; gap: 0.125rem; }
  .blk.on .blk-body { gap: 0.5rem; }
  .blk-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; margin-block-start: 0.875rem; }
  .btn { min-block-size: 2rem; padding: 0.2rem 0.7rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font: 500 0.8125rem var(--sans); cursor: pointer; }
  .keys { color: var(--muted); font: 400 0.75rem var(--mono); }
  .zipcity { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: 0.5rem; }
  .country { margin: 0 0 0.375rem; font-size: 0.9375rem; line-height: 2rem; }
  /* At rest post code and city read as one address line; the post code takes the width of its digits where the browser can. */
  .blk:not(.on) .zipcity { grid-template-columns: auto minmax(0, 1fr); gap: 0; }
  .blk:not(.on) .zipcity :global(.field:first-child input) { inline-size: 4.25rem; field-sizing: content; min-inline-size: 3.5rem; }
  .blk:not(.on) .zipcity :global(.field.missing:first-child input) { min-inline-size: 7rem; }

  .grp { display: flex; flex-direction: column; gap: 0.125rem; margin: 0; padding: 0; border: 0; min-width: 0; }
  .grp legend { padding: 0; font: 500 0.8125rem/1.3 var(--sans); }
  .group-hint { margin: 0; color: var(--muted); font-size: 0.75rem; line-height: 1.4; max-inline-size: 70ch; }
  .group-hint.active { color: var(--ink); }
  .group-error { display: flex; gap: 0.375rem; margin: 0.125rem 0; color: var(--danger); font: 500 0.8125rem/1.35 var(--sans); }
  .choices { display: flex; flex-wrap: wrap; align-items: center; gap: 0 1.25rem; }
  .choice { display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: 2rem; font: 500 0.875rem var(--sans); cursor: pointer; }
  .choice input { inline-size: 1.125rem; block-size: 1.125rem; margin: 0; accent-color: var(--ink); }
  .leitweg { display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.5rem; }
  .leitweg .group-hint { flex-basis: 100%; }
  .blk.on .grp { gap: 0.5rem; margin-block-start: 0.25rem; padding: 0.125rem 0 0.25rem 0.75rem; border-inline-start: 1px solid var(--rule); }
  .regime { margin-block-end: 0.75rem; }
  /* Resting block: what only serves editing leaves the document. A group with nothing to show leaves too. */
  .blk:not(.on) .grp legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .blk:not(.on) .grp:not(.need) > .group-hint,
  .blk:not(.on) .choices,
  .blk:not(.on) .regime,
  .blk:not(.on) .leitweg:not(:has(input:checked)),
  .blk:not(.on) .leitweg .sec-help,
  .blk:not(.on) .leitweg .group-hint,
  .blk:not(.on) .reasons h3,
  .blk:not(.on) .reasons dt,
  .blk:not(.on) .reason-terms { display: none; }
  .blk:not(.on) .leitweg { color: var(--muted); }
  .reasons { margin-block-start: 0.75rem; }
  .reasons h3 { margin: 0 0 0.25rem; font: 500 0.8125rem/1.3 var(--sans); }
  .reasons dl { margin: 0; }
  .reasons dt { font: 500 0.8125rem var(--sans); }
  .reasons dd { margin: 0 0 0.25rem; font: 400 0.9375rem/1.5 var(--sans); max-inline-size: 75ch; }
  .reason-terms { color: var(--muted); font-size: 0.8125rem; }
  .notice { display: flex; gap: 0.5rem; margin: 1rem 0 0; color: var(--muted); font-size: 0.75rem; line-height: 1.4; }

  @container (min-width: 48rem) {
    .sheet-grid { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
    .b-lines { grid-column: 1 / -1; }
    .b-document { grid-row: span 2; }
  }
  @media (max-width: 47.99rem) {
    /* Narrow screens: one line at the thumb. Status and amount, the next open point, and a drawer for check and export. */
    .desk { padding-block-end: 5.5rem; }
    .bar { position: fixed; inset: auto 0 0 0; top: auto; z-index: 3; flex-direction: column-reverse; flex-wrap: nowrap; align-items: stretch; gap: 0; padding: 0; border-bottom: 0; box-shadow: 0 -0.25rem 0 var(--rule); }
    .bar-main { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-rows: auto auto; align-items: center; gap: 0 0.5rem; padding: 0.5rem clamp(0.75rem, 4vw, 1.25rem) calc(0.5rem + env(safe-area-inset-bottom)); }
    .bar-status { grid-column: 1; grid-row: 1; font-size: 0.8125rem; }
    /* The amount stands in the document's totals; the one line at the thumb belongs to the status. */
    .bar-status { grid-row: 1 / 3; line-height: 1.25; }
    .bar-gross { display: none; }
    .act.next, .act.menu { grid-row: 1 / 3; display: inline-flex; align-items: center; gap: 0.25rem; min-height: 2.75rem; padding-inline: 0.625rem; }
    .act .long { display: none; }
    .act .short { display: inline; }
    .bar-more { display: none; }
    .bar-more.shown { display: flex; flex-direction: column; gap: 0.625rem; max-block-size: 70vh; overflow: auto; padding: 0.75rem clamp(0.75rem, 4vw, 1.25rem); border-bottom: 1px solid var(--rule); }
    .bar-actions { display: grid; grid-template-columns: 1fr 1fr; }
    .bar-actions .check { grid-column: 1 / -1; }
    .bar-actions .act { min-height: 2.75rem; }
    .outline ol { flex-direction: column; }
    .outline a { inline-size: 100%; min-block-size: 2.75rem; border-bottom: 1px solid var(--rule); font-size: 0.8125rem; }
    .o-count { margin-inline-start: auto; }
    .sheet { box-shadow: none; }
    .blk { margin-inline-start: -0.625rem; padding-inline-start: calc(0.625rem - 3px); }
  }
  @media (pointer: coarse) { .sec-help { inline-size: 2.75rem; block-size: 2.75rem; } .btn, .choice { min-block-size: 2.75rem; } .act { min-height: 2.75rem; } }
  @media (prefers-reduced-motion: reduce) { .blk { transition: none; } }
</style>
