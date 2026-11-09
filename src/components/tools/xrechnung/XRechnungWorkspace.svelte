<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { formatLocalizedDecimal } from '../../../lib/domain/xrechnung/number-notation.ts';
  import { copy, describeError, fill, openCountText } from '../../../i18n/xrechnung.ts';
  import type { HelpId } from '../../../i18n/xrechnung-help.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Field from './Field.svelte';
  import Glyph from './Glyph.svelte';
  import HelpDrawer from './HelpDrawer.svelte';
  import LinesEditor from './LinesEditor.svelte';
  import ScopeNote from './ScopeNote.svelte';
  import SummaryRail, { type RailStatus } from './SummaryRail.svelte';
  import { activeFixedReasons, checkForm, countByKind, exportXml, hasReverseCharge, previewTotals, type DiagnosticItem, type ExportFormat, type SectionId } from './form-adapter.ts';
  import { emptyFormState } from './form-state.ts';

  let { locale }: { locale: Locale } = $props();

  const form = $state(emptyFormState());
  const initial = JSON.stringify(emptyFormState());
  let touched = $state<Record<string, boolean>>({});
  let checked = $state(false);
  let lastExport = $state<{ format: ExportFormat; time: string; snapshot: string } | undefined>();
  let exportFailure = $state<string | undefined>();
  let announcement = $state('');
  let wide = $state(true);
  let dockOpen = $state(false);
  let drawer: HelpDrawer | undefined = $state();
  let statusHeading: HTMLElement | undefined = $state();

  // The domain answers on every change: full validation, and the lines-only preview for the totals.
  const result = $derived(checkForm(form));
  const items = $derived<readonly DiagnosticItem[]>(result.ok ? [] : result.items);
  const truncated = $derived(!result.ok && result.truncated);
  const counts = $derived(countByKind(items));
  const preview = $derived(previewTotals(form));
  const totals = $derived(result.ok ? result.invoice.totals : preview.ok ? preview.totals : undefined);
  const snapshot = $derived(JSON.stringify(form));
  const status = $derived<RailStatus>(
    snapshot === initial && !checked ? 'pristine' : counts.invalid + counts.internal > 0 ? 'invalid' : counts.missing > 0 ? 'incomplete' : 'local',
  );
  const changedSinceExport = $derived(lastExport !== undefined && lastExport.snapshot !== snapshot);
  const summaryText = $derived(status === 'pristine' ? '' : status === 'local' ? copy['status.local'][locale] : openCountText(counts.missing, counts.invalid + counts.internal, locale));

  // Field errors appear after a field loses focus or after "Prüfen"; the counts above are always live.
  const fieldErrors = $derived.by(() => {
    const map: Record<string, string> = {};
    for (const item of items) {
      if (item.fieldId !== item.path || item.kind === 'internal') continue;
      if (checked || touched[item.path]) map[item.path] = describeError(item.code, item.path, locale);
    }
    return map;
  });
  const errorFor = (id: string): string | undefined => fieldErrors[id];
  const touch = (id: string): void => { touched[id] = true; };
  const groupError = (code: string, path: string): string | undefined => {
    if (!checked) return undefined;
    const item = items.find((entry) => entry.code === code && entry.path === path);
    return item ? describeError(item.code, item.path, locale) : undefined;
  };
  const sectionCounts = (section: SectionId) => countByKind(items.filter((item) => item.section === section));
  const sectionChip = (section: SectionId): { kind: 'ok' | 'error' | 'incomplete'; text: string } => {
    const c = sectionCounts(section);
    if (c.invalid + c.internal > 0) return { kind: 'error', text: fill(copy.secErrors[locale], { n: c.invalid + c.internal }) };
    if (c.missing > 0) return { kind: 'incomplete', text: fill(copy.secOpen[locale], { n: c.missing }) };
    return { kind: 'ok', text: copy['diag.none'][locale] };
  };

  $effect(() => {
    const text = summaryText;
    const timer = setTimeout(() => { announcement = text; }, 800);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    const query = matchMedia('(min-width: 64rem)');
    const update = () => { wide = query.matches; };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });

  async function goTo(id: string): Promise<void> {
    dockOpen = false;
    await tick();
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    element.focus({ preventScroll: true });
  }

  async function showResults(): Promise<void> {
    checked = true;
    dockOpen = true;
    await tick();
    statusHeading?.focus();
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

  const gross = $derived(totals ? `${formatLocalizedDecimal(totals.totalWithVat, 'de')} EUR${result.ok ? '' : ` ${copy['dock.preview'][locale]}`}` : '—');
  const meansOptions = [{ value: '30', label: copy.means30[locale] }, { value: '58', label: copy.means58[locale] }];
  const schemeOptions = [
    { value: 'EM', label: copy.schemeEM[locale] },
    { value: '0204', label: copy.scheme0204[locale] },
    { value: '0088', label: copy.scheme0088[locale] },
  ];
  const f = form.fields;
  const reasons = $derived(activeFixedReasons(form));
  const buyerNeedsId = $derived(hasReverseCharge(form));
</script>

{#snippet head(section: SectionId, helpId: HelpId | undefined)}
  {@const chip = sectionChip(section)}
  <div class="sec-head">
    <h2 id={`h-${section}`}>{copy[`sec.${section}`][locale]}</h2>
    {#if helpId}
      <button type="button" class="sec-help" aria-label={fill(copy.helpFor[locale], { field: copy[`sec.${section}`][locale] })} onclick={(event) => openHelp(helpId, event.currentTarget)}>?</button>
    {/if}
    <span class={`chip ${chip.kind}`}><Glyph kind={chip.kind} /> {chip.text}</span>
  </div>
{/snippet}

<form class="workspace" novalidate onsubmit={(event) => { event.preventDefault(); void showResults(); }}>
  <div class="main">
    <p class="legend">{copy.requiredLegend[locale]}</p>
    <ScopeNote {locale} />

    <section aria-labelledby="h-document" id="section-document">
      {@render head('document', undefined)}
      <div class="grid-meta">
        <Field id="invoiceNumber" {locale} label={copy['f.invoiceNumber'][locale]} required bind:value={f.invoiceNumber} error={errorFor('invoiceNumber')} onblur={() => touch('invoiceNumber')} />
        <Field id="issueDate" {locale} label={copy['f.issueDate'][locale]} required kind="date" bind:value={f.issueDate} error={errorFor('issueDate')} onblur={() => touch('issueDate')} />
        <fieldset class="group supply span-all" aria-describedby="supply-hint">
          <legend>{copy['grp.supply'][locale]}</legend>
          <p class="group-hint" id="supply-hint">{copy['grp.supplyHint'][locale]}</p>
          <div class="choices">
            <label class="choice"><input type="radio" name="supplyMode" value="date" bind:group={form.supplyMode} /> {copy['supply.date'][locale]}</label>
            <label class="choice"><input type="radio" name="supplyMode" value="period" bind:group={form.supplyMode} /> {copy['supply.period'][locale]}</label>
          </div>
          {#if form.supplyMode === 'date'}
            <div class="two">
              <Field id="deliveryDate" {locale} label={copy['f.deliveryDate'][locale]} required kind="date" bind:value={f.deliveryDate} helpId="deliveryDate" error={errorFor('deliveryDate')} onblur={() => touch('deliveryDate')} onmore={(el) => openHelp('deliveryDate', el)} />
            </div>
          {:else}
            <div class="two">
              <Field id="invoicingPeriod.startDate" {locale} label={copy['f.periodStart'][locale]} required kind="date" bind:value={f['invoicingPeriod.startDate']} helpId="invoicingPeriod" error={errorFor('invoicingPeriod.startDate')} onblur={() => touch('invoicingPeriod.startDate')} onmore={(el) => openHelp('invoicingPeriod', el)} />
              <Field id="invoicingPeriod.endDate" {locale} label={copy['f.periodEnd'][locale]} required kind="date" bind:value={f['invoicingPeriod.endDate']} error={errorFor('invoicingPeriod.endDate')} onblur={() => touch('invoicingPeriod.endDate')} />
            </div>
          {/if}
        </fieldset>
        <div class="buyer-ref">
          <Field id="buyerReference" {locale} label={copy['f.buyerReference'][locale]} required bind:value={f.buyerReference} helpId="buyerReference" error={errorFor('buyerReference')} onblur={() => touch('buyerReference')} onmore={(el) => openHelp('buyerReference', el)} />
          <div class="leitweg">
            <label class="choice"><input id="leitwegCheck" type="checkbox" bind:checked={form.leitwegCheck} aria-describedby="leitweg-note" onchange={() => { if (form.leitwegCheck && f.buyerReference !== '') touch('buyerReference'); }} /> {copy.leitwegCheck[locale]}</label>
            <button type="button" class="sec-help" aria-label={fill(copy.helpFor[locale], { field: copy.leitwegCheck[locale] })} onclick={(event) => openHelp('leitwegCheck', event.currentTarget)}>?</button>
            <p class="hint" id="leitweg-note">{copy.leitwegNote[locale]}</p>
          </div>
        </div>
        <fieldset class="group span-all">
          <legend>{copy['grp.references'][locale]}</legend>
          <p class="group-hint">{copy['grp.referencesHint'][locale]}</p>
          <div class="two">
            <Field id="projectReference" {locale} label={copy['f.projectReference'][locale]} optionalMark bind:value={f.projectReference} helpId="references" error={errorFor('projectReference')} onblur={() => touch('projectReference')} onmore={(el) => openHelp('references', el)} />
            <Field id="contractReference" {locale} label={copy['f.contractReference'][locale]} optionalMark bind:value={f.contractReference} helpId="references" error={errorFor('contractReference')} onblur={() => touch('contractReference')} onmore={(el) => openHelp('references', el)} />
            <Field id="orderReference" {locale} label={copy['f.orderReference'][locale]} optionalMark bind:value={f.orderReference} helpId="references" error={errorFor('orderReference')} onblur={() => touch('orderReference')} onmore={(el) => openHelp('references', el)} />
          </div>
        </fieldset>
        <dl class="fixed">
          <div><dt>{copy.documentType[locale]}</dt><dd>{copy.fixed380[locale]}</dd></div>
          <div><dt>{copy.currency[locale]}</dt><dd>{copy.fixedEUR[locale]}</dd></div>
        </dl>
      </div>
    </section>

    <div class="parties">
      <section aria-labelledby="h-seller" id="section-seller">
        {@render head('seller', 'sec.seller')}
        <div class="grid-party">
          <div class="span"><Field id="seller.name" {locale} label={copy['f.name'][locale]} required bind:value={f['seller.name']} error={errorFor('seller.name')} onblur={() => touch('seller.name')} /></div>
          <div class="span"><Field id="seller.address.street" {locale} label={copy['f.street'][locale]} required autocomplete="street-address" bind:value={f['seller.address.street']} error={errorFor('seller.address.street')} onblur={() => touch('seller.address.street')} /></div>
          <Field id="seller.address.postCode" {locale} label={copy['f.postCode'][locale]} required bind:value={f['seller.address.postCode']} error={errorFor('seller.address.postCode')} onblur={() => touch('seller.address.postCode')} />
          <Field id="seller.address.city" {locale} label={copy['f.city'][locale]} required bind:value={f['seller.address.city']} error={errorFor('seller.address.city')} onblur={() => touch('seller.address.city')} />
          <dl class="fixed span"><div><dt>{copy.country[locale]}</dt><dd>{copy.fixedDE[locale]}</dd></div></dl>
          <Field id="seller.electronicAddress.schemeId" {locale} label={copy['f.schemeId'][locale]} required kind="select" options={schemeOptions} bind:value={f['seller.electronicAddress.schemeId']} helpId="electronicAddress" hint={copy.schemeHint[locale]} error={errorFor('seller.electronicAddress.schemeId')} onblur={() => touch('seller.electronicAddress.schemeId')} onmore={(el) => openHelp('electronicAddress', el)} />
          <Field id="seller.electronicAddress.value" {locale} label={copy['f.addressValue'][locale]} required bind:value={f['seller.electronicAddress.value']} error={errorFor('seller.electronicAddress.value')} onblur={() => touch('seller.electronicAddress.value')} />
          <div class="span"><Field id="seller.contact.name" {locale} label={copy['f.contactName'][locale]} required autocomplete="name" bind:value={f['seller.contact.name']} helpId="sellerContact" error={errorFor('seller.contact.name')} onblur={() => touch('seller.contact.name')} onmore={(el) => openHelp('sellerContact', el)} /></div>
          <Field id="seller.contact.telephone" {locale} label={copy['f.contactTelephone'][locale]} required inputmode="tel" autocomplete="tel" bind:value={f['seller.contact.telephone']} error={errorFor('seller.contact.telephone')} onblur={() => touch('seller.contact.telephone')} />
          <Field id="seller.contact.email" {locale} label={copy['f.contactEmail'][locale]} required inputmode="email" autocomplete="email" bind:value={f['seller.contact.email']} error={errorFor('seller.contact.email')} onblur={() => touch('seller.contact.email')} />
          <fieldset class="group span">
            <legend>{copy['grp.sellerTax'][locale]}</legend>
            <p class="group-hint">{copy['grp.sellerTaxHint'][locale]}</p>
            {#if groupError('missing_seller_tax_identifier', 'seller')}<p class="group-error" role="alert"><Glyph kind="error" /> {groupError('missing_seller_tax_identifier', 'seller')}</p>{/if}
            <div class="two">
              <Field id="seller.vatId" {locale} label={copy['f.vatId'][locale]} optionalMark bind:value={f['seller.vatId']} helpId="sellerVatId" error={errorFor('seller.vatId')} onblur={() => touch('seller.vatId')} onmore={(el) => openHelp('sellerVatId', el)} />
              <Field id="seller.taxRegistrationId" {locale} label={copy['f.taxRegistrationId'][locale]} optionalMark bind:value={f['seller.taxRegistrationId']} helpId="sellerTaxNumber" error={errorFor('seller.taxRegistrationId')} onblur={() => touch('seller.taxRegistrationId')} onmore={(el) => openHelp('sellerTaxNumber', el)} />
            </div>
          </fieldset>
          <fieldset class="group span">
            <legend>{copy['grp.sellerId'][locale]}</legend>
            {#if groupError('missing_seller_identification', 'seller')}<p class="group-error" role="alert"><Glyph kind="error" /> {groupError('missing_seller_identification', 'seller')}</p>{/if}
            <div class="two">
              <Field id="seller.legalRegistrationId" {locale} label={copy['f.legalRegistrationId'][locale]} optionalMark bind:value={f['seller.legalRegistrationId']} helpId="sellerIdentification" error={errorFor('seller.legalRegistrationId')} onblur={() => touch('seller.legalRegistrationId')} onmore={(el) => openHelp('sellerIdentification', el)} />
              <Field id="seller.sellerIdentifiers[0]" {locale} label={copy['f.sellerIdentifier'][locale]} optionalMark bind:value={f['seller.sellerIdentifiers[0]']} error={errorFor('seller.sellerIdentifiers[0]')} onblur={() => touch('seller.sellerIdentifiers[0]')} />
            </div>
          </fieldset>
        </div>
      </section>

      <section aria-labelledby="h-buyer" id="section-buyer">
        {@render head('buyer', 'sec.buyer')}
        <div class="grid-party">
          <div class="span"><Field id="buyer.name" {locale} label={copy['f.name'][locale]} required bind:value={f['buyer.name']} error={errorFor('buyer.name')} onblur={() => touch('buyer.name')} /></div>
          <div class="span"><Field id="buyer.address.street" {locale} label={copy['f.street'][locale]} required bind:value={f['buyer.address.street']} error={errorFor('buyer.address.street')} onblur={() => touch('buyer.address.street')} /></div>
          <Field id="buyer.address.postCode" {locale} label={copy['f.postCode'][locale]} required bind:value={f['buyer.address.postCode']} error={errorFor('buyer.address.postCode')} onblur={() => touch('buyer.address.postCode')} />
          <Field id="buyer.address.city" {locale} label={copy['f.city'][locale]} required bind:value={f['buyer.address.city']} error={errorFor('buyer.address.city')} onblur={() => touch('buyer.address.city')} />
          <dl class="fixed span"><div><dt>{copy.country[locale]}</dt><dd>{copy.fixedDE[locale]}</dd></div></dl>
          <Field id="buyer.electronicAddress.schemeId" {locale} label={copy['f.schemeId'][locale]} required kind="select" options={schemeOptions} bind:value={f['buyer.electronicAddress.schemeId']} helpId="electronicAddress" hint={copy.schemeHint[locale]} error={errorFor('buyer.electronicAddress.schemeId')} onblur={() => touch('buyer.electronicAddress.schemeId')} onmore={(el) => openHelp('electronicAddress', el)} />
          <Field id="buyer.electronicAddress.value" {locale} label={copy['f.addressValue'][locale]} required bind:value={f['buyer.electronicAddress.value']} error={errorFor('buyer.electronicAddress.value')} onblur={() => touch('buyer.electronicAddress.value')} />
          <fieldset class="group span" aria-describedby="buyer-id-hint">
            <legend>{copy['grp.buyerId'][locale]}</legend>
            <p class="group-hint" id="buyer-id-hint">{buyerNeedsId ? copy['grp.buyerIdHintRc'][locale] : copy['grp.buyerIdHint'][locale]}</p>
            {#if groupError('missing_buyer_identifier', 'buyer')}<p class="group-error" role="alert"><Glyph kind="error" /> {groupError('missing_buyer_identifier', 'buyer')}</p>{/if}
            <div class="two">
              <Field id="buyer.vatId" {locale} label={copy['f.vatId'][locale]} optionalMark bind:value={f['buyer.vatId']} helpId="buyerIdentification" error={errorFor('buyer.vatId')} onblur={() => touch('buyer.vatId')} onmore={(el) => openHelp('buyerIdentification', el)} />
              <Field id="buyer.legalRegistrationId" {locale} label={copy['f.legalRegistrationId'][locale]} optionalMark bind:value={f['buyer.legalRegistrationId']} error={errorFor('buyer.legalRegistrationId')} onblur={() => touch('buyer.legalRegistrationId')} />
            </div>
          </fieldset>
        </div>
      </section>
    </div>

    <section aria-labelledby="h-lines" id="section-lines">
      {@render head('lines', 'sec.lines')}
      <fieldset class="group regime" aria-describedby="vat-regime-hint">
        <legend>{copy['vatRegime.legend'][locale]}</legend>
        <p class="group-hint" id="vat-regime-hint">{copy['vatRegime.hint'][locale]}</p>
        <div class="choices">
          <label class="choice"><input id="vatRegime.regular" type="radio" name="vatRegime" value="regular" bind:group={form.vatRegime} /> {copy['vatRegime.regular'][locale]}</label>
          <label class="choice"><input id="vatRegime.kleinunternehmer" type="radio" name="vatRegime" value="kleinunternehmer" bind:group={form.vatRegime} /> {copy['vatRegime.kleinunternehmer'][locale]}</label>
          <button type="button" class="sec-help" aria-label={fill(copy.helpFor[locale], { field: copy['vatRegime.legend'][locale] })} onclick={(event) => openHelp('vatRegime', event.currentTarget)}>?</button>
        </div>
        {#if form.vatRegime === 'kleinunternehmer'}<p class="group-hint">{copy['vatRegime.kuSellerHint'][locale]}</p>{/if}
      </fieldset>
      <LinesEditor bind:lines={form.lines} {locale} totals={totals} {errorFor} {touch} onmore={(id, el) => openHelp(id, el)} groupError={groupError('no_lines', 'lines')} regime={form.vatRegime} />
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
    </section>

    <section aria-labelledby="h-payment" id="section-payment">
      {@render head('payment', 'sec.payment')}
      <div class="grid-pay">
        <Field id="payment.means.code" {locale} label={copy['f.meansCode'][locale]} required kind="select" options={meansOptions} bind:value={f['payment.means.code']} helpId="paymentMeans" hint={copy.meansHint[locale]} error={errorFor('payment.means.code')} onblur={() => touch('payment.means.code')} onmore={(el) => openHelp('paymentMeans', el)} />
        <Field id="payment.means.account.id.value" {locale} label={copy['f.iban'][locale]} required autocomplete="off" bind:value={f['payment.means.account.id.value']} helpId="iban" hint={copy.ibanHint[locale]} error={errorFor('payment.means.account.id.value')} onblur={() => touch('payment.means.account.id.value')} onmore={(el) => openHelp('iban', el)} />
        <Field id="payment.means.account.name" {locale} label={copy['f.accountName'][locale]} optionalMark bind:value={f['payment.means.account.name']} error={errorFor('payment.means.account.name')} onblur={() => touch('payment.means.account.name')} />
        <Field id="payment.means.account.bic" {locale} label={copy['f.bic'][locale]} optionalMark bind:value={f['payment.means.account.bic']} helpId="bic" error={errorFor('payment.means.account.bic')} onblur={() => touch('payment.means.account.bic')} onmore={(el) => openHelp('bic', el)} />
        <fieldset class="group span-all">
          <legend>{copy['grp.paymentDue'][locale]}</legend>
          <p class="group-hint">{copy['grp.paymentDueHint'][locale]}</p>
          {#if groupError('missing_payment_due_information', 'payment')}<p class="group-error" role="alert"><Glyph kind="error" /> {groupError('missing_payment_due_information', 'payment')}</p>{/if}
          <div class="two">
            <Field id="payment.dueDate" {locale} label={copy['f.dueDate'][locale]} optionalMark kind="date" bind:value={f['payment.dueDate']} helpId="paymentDue" error={errorFor('payment.dueDate')} onblur={() => touch('payment.dueDate')} onmore={(el) => openHelp('paymentDue', el)} />
            <Field id="payment.termsText" {locale} label={copy['f.termsText'][locale]} optionalMark kind="textarea" rows={2} bind:value={f['payment.termsText']} error={errorFor('payment.termsText')} onblur={() => touch('payment.termsText')} />
          </div>
        </fieldset>
      </div>
    </section>

    <section aria-labelledby="h-notes" id="section-notes">
      {@render head('notes', undefined)}
      <Field id="notes[0].text" {locale} label={copy['f.note'][locale]} optionalMark kind="textarea" rows={3} bind:value={f['notes[0].text']} error={errorFor('notes[0].text')} onblur={() => touch('notes[0].text')} />
    </section>
  </div>

  <aside class="rail" aria-labelledby="rail-title">
    <details open={wide || dockOpen} ontoggle={(event) => { if (!wide) dockOpen = event.currentTarget.open; }}>
      <summary class="dock-summary"><span id="rail-title">{copy['dock.summary'][locale]}</span> <span class="dock-state">{summaryText || copy['status.pristine'][locale]} · {gross}</span></summary>
      <SummaryRail
        {locale} {status} {totals} calculated={result.ok} {items} {truncated} {counts} generated={lastExport} {changedSinceExport}
        exportReady={result.ok} {announcement} {exportFailure} onexport={runExport} ongoto={(id) => void goTo(id)} bind:headingEl={statusHeading}
      />
    </details>
  </aside>
</form>

<HelpDrawer bind:this={drawer} {locale} onjump={(id) => void goTo(id)} />

<style>
  .workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); align-items: start; padding-block: var(--space-2) var(--space-4); --rail-w: clamp(21rem, 24vw, 26rem); }
  .main { container-type: inline-size; display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
  .legend { margin: 0; color: var(--muted); font: 400 0.8125rem var(--mono); }
  section { border-top: 1px solid var(--ink); padding-block-start: 0.5rem; min-width: 0; }
  .sec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; margin-bottom: 0.75rem; }
  h2 { margin: 0; font: 600 1.0625rem/1.3 var(--serif); }
  .sec-help { inline-size: 1.5rem; block-size: 1.5rem; padding: 0; border: 1px solid var(--ink); border-radius: 50%; background: var(--paper); color: var(--ink); font: 500 0.75rem/1 var(--mono); cursor: pointer; }
  .chip { display: inline-flex; gap: 0.375rem; align-items: center; margin-inline-start: auto; padding: 0.1rem 0.5rem; font: 500 0.75rem/1.4 var(--mono); border: 1px solid var(--rule); }
  .chip.incomplete { background: var(--highlight); border-color: var(--highlight); }
  .chip.error { border: 1px solid var(--danger); color: var(--danger); font-weight: 500; }
  .grid-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.75rem 1rem; align-items: start; }
  .fixed { display: flex; flex-wrap: wrap; gap: 0.25rem 1.5rem; margin: 0; padding: 0; align-self: end; }
  .fixed div { display: flex; flex-direction: column; }
  .fixed dt { font: 500 0.8125rem/1.3 var(--sans); }
  .fixed dd { margin: 0; font: 400 0.9375rem/1.8 var(--sans); }
  .parties { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .grid-party, .grid-pay { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem 0.75rem; align-items: start; }
  .span, .span-all { grid-column: 1 / -1; }
  .choices { display: flex; flex-wrap: wrap; gap: 0.25rem 1.5rem; margin-bottom: 0.5rem; }
  .choice { display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: 2.25rem; font: 500 0.875rem var(--sans); cursor: pointer; }
  .choice input { inline-size: 1.125rem; block-size: 1.125rem; margin: 0; accent-color: var(--ink); }
  .leitweg { display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.5rem; margin-block-start: 0.25rem; }
  .leitweg .hint { flex-basis: 100%; margin: 0; max-inline-size: 60ch; color: var(--muted); font-size: 0.8125rem; }
  .buyer-ref { grid-column: 1 / -1; max-inline-size: 36rem; }
  @media (pointer: coarse) { .leitweg .sec-help { inline-size: 2.75rem; block-size: 2.75rem; } }
  .group { margin: 0; padding: 0.5rem 0.75rem 0.75rem; border: 1px solid var(--rule); min-width: 0; }
  .group legend { padding-inline: 0.25rem; font: 500 0.8125rem/1.3 var(--sans); }
  .group-hint { margin: 0 0 0.5rem; color: var(--muted); font-size: 0.8125rem; max-inline-size: 70ch; }
  .regime { margin-block-end: 0.75rem; }
  .regime .choices { align-items: center; margin-bottom: 0; }
  .reasons { margin-block-start: 0.75rem; border-top: 0; padding-block-start: 0; }
  .reasons h3 { margin: 0 0 0.25rem; font: 500 0.8125rem/1.3 var(--sans); }
  .reasons dl { margin: 0; }
  .reasons dl div { padding-block: 0.25rem; border-top: 1px solid var(--rule); }
  .reasons dt { font: 500 0.8125rem var(--sans); }
  .reasons dd { margin: 0; font: 400 0.9375rem/1.5 var(--sans); }
  .reason-terms { color: var(--muted); font-size: 0.8125rem; }
  .group-error { display: flex; gap: 0.375rem; margin: 0 0 0.5rem; color: var(--danger); font: 500 0.8125rem var(--sans); }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; align-items: start; }
  .rail { min-width: 0; }
  .dock-summary { display: none; }
  @container (min-width: 40rem) { .parties { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 64rem) {
    .workspace { grid-template-columns: minmax(0, 1fr) var(--rail-w); }
    .rail { position: sticky; top: var(--space-2); max-height: calc(100dvh - 2 * var(--space-2)); overflow-y: auto; }
  }
  @media (max-width: 63.99rem) {
    .rail { position: sticky; bottom: 0; z-index: 2; background: var(--paper); border-top: 1px solid var(--ink); margin-inline: calc(-1 * clamp(1.25rem, 5vw, 4.5rem)); padding-inline: clamp(1.25rem, 5vw, 4.5rem); }
    .dock-summary { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 1rem; padding-block: 0.5rem; cursor: pointer; font: 500 0.875rem var(--sans); }
    .dock-state { font-family: var(--mono); font-size: 0.8125rem; }
    .rail :global(.rail-body) { max-height: 70dvh; overflow-y: auto; padding-block: 0.5rem 1rem; }
  }
  @media (max-width: 47.99rem) { .grid-party, .grid-pay { grid-template-columns: minmax(0, 1fr); } .grid-meta { grid-template-columns: minmax(0, 1fr); } }
</style>
