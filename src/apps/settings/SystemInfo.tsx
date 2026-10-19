/** System information: product, build, platform, engine, storage and the commissioned site. */
import { CATALOG_VERSION } from '../../catalog';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { APP_VERSION } from '../../os/kernel';
import { isStandaloneDisplay } from '../../os/platform';
import { useSettingsStore } from '../../os/settings/store';
import { KeyValue, fmt } from '../../ui';

export function SystemInfo() {
  const t = useT();
  const topo = useEngineStore((s) => s.topology);
  const mode = useEngineStore((s) => s.mode);
  const storage = useEngineStore((s) => s.storageKind);
  const settings = useSettingsStore((s) => s.settings);
  const build = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
  const sha = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'local';
  return (
    <div className="st-about">
      <div className="st-about__brand">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={72} height={72} />
        <div>
          <div className="st-about__name">Safeton</div>
          <div className="sf-muted">AI Infrastructure OS</div>
          <div className="mono sf-muted">
            {t('about.version', { version: APP_VERSION })} · {sha}
          </div>
        </div>
      </div>
      <section className="st-group">
        <div className="st-group__box st-pad">
          <KeyValue
            items={[
              [t('about.host'), settings.system.hostname],
              [t('about.build'), build ? fmt.dateTime(Date.parse(build), false) : '—'],
              [t('about.catalog'), CATALOG_VERSION],
              [
                t('about.engine'),
                mode === 'worker' ? t('monitor.engine.worker') : t('monitor.engine.inProcess'),
              ],
              [t('about.storage'), storage === 'indexeddb' ? 'IndexedDB' : t('backup.volatile')],
              [t('about.mode'), isStandaloneDisplay() ? t('about.mode.installed') : t('about.mode.browser')],
              [t('about.display'), `${screen.width} × ${screen.height} @ ${devicePixelRatio}×`],
              [t('about.cores'), String(navigator.hardwareConcurrency ?? '—')],
              [
                t('about.infra'),
                topo
                  ? `${topo.spec.name} · ${topo.nodes.length} nodes · ${fmt.formatNumber(topo.gpuCount)} GPUs`
                  : '—',
              ],
              [t('about.site'), topo ? `${topo.spec.site.name} (${topo.spec.site.code})` : '—'],
            ]}
          />
        </div>
      </section>
      <p className="st-legal">{t('about.legal')}</p>
    </div>
  );
}
