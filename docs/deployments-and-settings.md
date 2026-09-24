# Deployments и Settings (KServe) — функциональные требования и детали реализации

Документ описывает **текущую** реализацию вкладок **Deployments** и **Settings → KServe**.

Стек: React 18, PatternFly 6, без OpenShift/Kubernetes npm-клиентов. Все обращения к кластеру идут REST-ом через in-process proxy `GET|POST|PUT|DELETE /k8s-proxy/*` (`distributions/nova-ai/src/cluster/k8sClient.ts`, webpack middleware `distributions/nova-ai/config/k8sProxy.js`). Учётка кластера берётся только из `.env` (`KUBECONFIG_BASE64`), UI подключения к кластеру нет.

Консоль создаёт и показывает только объекты с меткой значения `nova-ai-console` (`nova-ai.io/console=nova-ai-console`, см. `consoleScope.ts`). Проекты = Namespace с этой меткой.

Сначала связи между объектами (**§0−**), карта экранов (**§A**), затем техническая реализация Deployments (**§1**) и Settings (**§2**).

---

## 0−. Что с чем связано

Консоль не ходит в API server из браузера: запросы идут через `/k8s-proxy` с kubeconfig из `.env` (`KUBECONFIG_BASE64`). Формы «подключиться к кластеру» нет.

**Проект** = Namespace с `nova-ai.io/console=nova-ai-console`. Имя проекта = имя namespace. Квота CPU/GPU/подов — соседний ResourceQuota. InferenceService из проекта A в проекте B не виден.

Консоль работает с KServe CR (типы в `crds.yaml`), не со списком подов.

| Часть CR | Кто пишет | Что хранит |
|---|---|---|
| `spec` | консоль / пользователь | образ, storageUri, реплики, runtime |
| `status` | контроллер KServe | Ready, URL, conditions |

При Save консоль **стирает `status`**. Список Deployments читает `status`, форма пишет `spec`. **Fields** и **YAML** — одно и то же; YAML нужен для полей, которых нет в форме.

### Deployments и Settings

| Settings (KServe) | Deployments |
|---|---|
| ClusterServingRuntime / ServingRuntime: образ, args, GPU, probes, `supportedModelFormats` | InferenceService: format + `storageUri` / `storage`, опционально runtime |
| ClusterStorageContainer: как качать `s3://`, `hf://` | InferenceGraph: шаги по уже существующим IS |

На Deployments создаётся экземпляр модели в проекте. Образ контейнера пользователь обычно не задаёт: KServe берёт `modelFormat` (например `huggingface`), находит runtime в Settings с этим format в `supportedModelFormats`, скачивает веса через StorageContainer, поднимает поды, пишет Ready и URL.

Если подходящего runtime нет, InferenceService сохранится, Status останется False/Unknown. Порядок: шаблон в Settings, затем деплой. Для sklearn шаблон часто уже pre-installed.

### Cluster vs namespaced (три таба Settings)

| Scope | Где объект | Кто пишет | Зачем |
|---|---|---|---|
| **Cluster** | без проекта | admin | общие ClusterServingRuntime / ClusterStorageContainer |
| **Namespaced** | в одном проекте | contributor в своём ns | свой ServingRuntime, не трогая cluster |

InferenceService и InferenceGraph **всегда** namespaced.

Contributor **видит** cluster-шаблоны, **не редактирует** их. ServingRuntime в своём namespace — может.

### InferenceService и InferenceGraph

**InferenceService (IS)** — одна модель, один HTTP/gRPC endpoint. Основные поля: `modelFormat`, `storageUri` (`s3://…` / `hf://…`) или `storage`, опционально `runtime`, resources.

**InferenceGraph (IG)** — маршрутизация между уже существующими IS (sequence / split / ensemble). `serviceName` шага — **имя InferenceService в том же проекте**, не URL.

На Deployments оба kind в одной таблице. Create сначала спрашивает Type.

### Три разных набора labels

1. **PlatformRole** — `nova-ai.io/deployments-enabled: "true"` включает sidebar Deployments. К CR модели не относится.
2. **Namespace** — `nova-ai.io/console: nova-ai-console`: иначе проект не попадает в список.
3. **Runtime / модель**:
   - `nova-ai.io/pre-installed: "true"` — Duplicate можно, Edit/Delete нельзя;
   - `vllm.version: "0.8.5"` — чипы **vllm** и **v0.8.5** в Settings;
   - labels на InferenceService — произвольные, на Status не влияют.

`spec.labels` / `spec.annotations` runtime — не чипы таблицы, а то, что KServe вешает на serving-pod (prometheus scrape и т.п.).

### Ready

Condition `type=Ready` пишет KServe, не консоль. Пока стартуют поды, качаются веса или нет runtime — False, либо conditions ещё нет (Unknown). URL появляется, когда KServe/Knative его выставил. Консоль status не вычисляет и модель не пингует.

Почему не Ready — таблица conditions на карточке (PredictorReady, RoutesReady, Reason, Message), не чип в списке. Refresh только перечитывает уже записанный status.

### Роли на этих вкладках

| В UI | Deployments | Settings cluster | Settings в проекте |
|---|---|---|---|
| **admin** | CRUD во всех Nova-проектах | Create/Edit/Delete/Duplicate | CRUD |
| **contributor** (developer) | CRUD в bound namespaces | только смотреть | CRUD своих ServingRuntime |
| **viewer** | список и URL | смотреть | смотреть |

Bound namespaces = `PlatformRoleBinding.spec.kubernetes.namespaces` (target `Namespaces`). Admin видит все Nova-проекты.

Deployments скрыт без `deployments-enabled`. Settings виден всем залогиненным.

### Цепочка Create → Ready

```
Deployments: POST InferenceService
  modelFormat.name = huggingface
  storageUri       = hf://org/llama
        │
        ▼
KServe (не консоль) ищет runtime:
  ServingRuntime в том же ns ИЛИ ClusterServingRuntime
  с huggingface в supportedModelFormats
        │
        ▼
KServe ищет ClusterStorageContainer
  с supportedUriFormats на "hf://"
  → init-контейнер качает веса
        │
        ▼
Поды из spec.containers runtime
  (image, GPU, probes, workerSpec)
        │
        ▼
status.conditions[Ready]=True
status.url = https://…
        │
        ▼
Deployments: зелёный Ready и ссылка
```

---

## 0. Общая модель доступа (нужна обеим вкладкам)

UI-кнопки считаются из `PlatformRole` / `PlatformRoleBinding`. Kubernetes ClusterRole (`nova-ai-aggregate-*`) нужны отдельно: без них apiserver вернёт 403 при том же UI.

Источник прав — CR `PlatformRole` / `PlatformRoleBinding` (`auth.nova-platform.io/v1alpha1`) плюс Kubernetes ClusterRole aggregation. UI-роль пользователя (`consoleRole`):

| `consoleRole` | Как получается | Может создавать проекты / Roles / Permissions | `canEdit` в проекте |
|---|---|---|---|
| `admin` | `nova-ai.io/console-persona: admin` **или** selector `nova-ai.io/aggregate-to-admin: "true"` | да | да |
| `contributor` | selector `nova-ai.io/aggregate-to-developer: "true"` (роли `nova-ai-developer` / `nova-ai-contributor`) | нет | да |
| `viewer` | selector `nova-ai.io/aggregate-to-viewer: "true"` | нет | нет (только просмотр) |

Код: `distributions/nova-ai/src/auth/access.ts` (`consoleRoleFromPlatformRole`, `computePlatformAccess`, `hasProjectService`).

`canEdit` на проект = `role === 'contributor' || role === 'admin'`. Viewer видит ресурсы, кнопки Create/Edit/Delete disabled или скрыты.

Видимые проекты:

- admin видит все Nova-проекты (`listProjects()`);
- contributor/viewer — только namespaces из `PlatformRoleBinding.spec.kubernetes.namespaces` (target `Namespaces`).

Kubernetes RBAC (манифест `distributions/nova-ai/manifests/clusterroles.yaml`):

- **developer** (`nova-ai-aggregate-developer`): `*` на namespaced `inferenceservices`, `inferencegraphs`, `servingruntimes`; `get/list/watch` на cluster `clusterservingruntimes`, `clusterstoragecontainers`. Нет `list` namespaces (чтобы не утекали чужие проекты).
- **viewer**: те же ресурсы, только `get/list/watch`.
- **admin** (`nova-ai-aggregate-admin`): `*` на `clusterservingruntimes`, `clusterstoragecontainers` (+ create namespaces / PlatformRole).

Proxy ходит в API server с kubeconfig из `.env`. Если apiserver не доверяет StarVault OIDC пользователя, фактически работает impersonation/учётка kubeconfig, а UI-роль всё равно считается из PlatformRoleBinding.

---

## A. Что происходит на вкладках Deployments и Settings

Этот раздел — обход глазами пользователя: что нарисовано, что можно нажать, чем сценарии отличаются у admin / contributor / viewer. Kubernetes-пути и поля форм — в §1–§2.

### A.1 Где эти вкладки живут

| Место | URL | Когда видно |
|---|---|---|
| Sidebar **Deployments** | `/deployments` | на PlatformRole есть `nova-ai.io/deployments-enabled: "true"` |
| Вкладка **Deployments** внутри проекта | `/projects/:project/deployments` | та же метка **и** пользователь видит этот проект |
| Карточка модели | `/deployments/:ns/:kind/:name` или `/projects/:project/deployments/:kind/:name` | переход из списка |
| Sidebar секция **Settings → KServe** | `/settings/kserve/…` | **всегда**, без метки |
| Подвкладки KServe | cluster-serving-runtimes / cluster-storage-containers / serving-runtimes | всегда, если открыт Settings |
| Карточка runtime/storage | `/settings/kserve/:tab/:name` или `.../:tab/:ns/:name` | переход из списка Settings |

Без `deployments-enabled` пункта Deployments нет ни в sidebar, ни в проекте. Settings от этой метки **не** зависит.

---

### A.2 Deployments — глобальный список (`/deployments`)

Все задеплоенные InferenceService и InferenceGraph в доступных проектах; не шаблоны из Settings. Одна строка = один CR.

Показать все задеплоенные модели во всех проектах, к которым есть доступ, и дать создать/править/удалить.

**Что происходит при входе**

1. Считаются видимые проекты (`listProjects` ∩ `canViewProject` ∩ сервис Deployments).
2. По каждому проекту параллельно list `inferenceservices` и `inferencegraphs`. Ошибка одного namespace глотается (пустой кусок), остальные рисуются.
3. Строки сливаются в одну таблицу, сортировка по имени.

**Что нарисовано**

- Текст: *View and manage the health and performance of deployed models.*
- Фильтр **Project**: All projects / конкретный namespace. Query `?project=`. Если выбран проект — ссылка **Go to** на Overview этого проекта, колонка Project скрывается.
- Кнопки **Create Deployment** (если есть хотя бы один проект с правом редактирования) и **Refresh**.
- Таблица: Name, Kind, Project (если All), Model format, Status, URL, Created, kebab.
- Status — чип Ready (зелёный) / Not ready (красный) / Unknown (серый) из condition `Ready`. Сразу после Create обычно Unknown, пока KServe не проставит status.
- URL — `status.url` (и fallback, §1.6). Пока Ready не True, часто пусто. Клик по ссылке не уводит со строки в details.
- Пустой список — empty state «No deployments» и Create, если можно.

**Что можно сделать**

| Действие | Как | Кто | Результат |
|---|---|---|---|
| Смотреть все модели | просто открыть вкладку | viewer+ | только свои проекты |
| Сузить к одному проекту | dropdown Project | все | те же данные, без колонки Project |
| Перейти в проект | Go to / имя в колонке Project не кликабельно; Go to ведёт на Overview | все | `/projects/<ns>/overview` |
| Отсортировать | клик по Name / Kind / Created | все | asc/desc |
| Обновить | Refresh | все | повторный list |
| Открыть модель | клик по строке или kebab View | все | страница details |
| Открыть endpoint | клик по URL | все | новая вкладка браузера |
| Создать | Create Deployment | contributor/admin | модалка (см. A.4) |
| Изменить | kebab Edit | contributor/admin **этого** проекта | та же модалка на существующем CR |
| Удалить | kebab Delete → confirm | contributor/admin этого проекта | DELETE CR, строка пропадает |

Viewer: Create скрыт, Edit/Delete disabled. Клик по строке и URL работают.

---

### A.3 Deployments — вкладка внутри проекта

Тот же `DeploymentsPage`, но `projectName` зафиксирован: нет выбора проекта, Create пишет только в этот namespace.

**Отличия от глобального списка**

- Нет текста-описания и нет dropdown Project / Go to.
- List только этого namespace.
- Create сразу пишет в этот проект (нет выбора namespace).
- Details открываются как `/projects/:project/deployments/:kind/:name` (хлебные крошки Projects → project → Deployments → name).

Сценарии те же: смотреть Status/URL, создать IS или IG, править, удалить, Refresh.

---

### A.4 Модалка Create / Edit Deployment

Type: InferenceService или InferenceGraph. Fields — ограниченный набор; YAML — полный манифест (affinity, кастомный workerSpec и всё, чего нет в Fields).

Открывается поверх списка или с details.

**Create**

1. Radio **Type**: InferenceService («Deploy a single model») или InferenceGraph («Route traffic across InferenceServices»). Смена типа сбрасывает spec, имя сохраняется.
2. Если проектов для записи несколько (глобальный список без фильтра) — dropdown **Project**.
3. Переключатель **Fields | YAML**.
4. **Save** → POST. Ошибки apiserver в Alert. Успех закрывает модалку и Refresh списка.

**Edit** — Type и Project заблокированы; PUT существующего объекта (без `status`).

**Fields, InferenceService — что заполняет пользователь**

- Имя, labels.
- Model format (обязательно, выпадающий список sklearn…triton).
- Args и Env списками.
- Где лежит модель: **Storage URI** *или* **Storage** (key+path), не оба сразу. URI — `s3://…` / `hf://…`; Storage — `key`+`path` для PVC-подобных бэкендов KServe. Скачивание делает ClusterStorageContainer из Settings, не эта форма.
- CPU/Memory request и limit — `resources` пода, не размер артефакта модели.
- Ports (containerPort, name, protocol).
- Advanced (свёрнут): protocol version, runtime (имя ServingRuntime/ClusterServingRuntime из Settings; пусто = KServe выберет по format), min/max replicas, service account, image, workerSpec pipeline/tensor parallel ≥ 1. Image в Advanced переопределяет образ runtime.

Нельзя сохранить без format и без URI (или storage key).

**Fields, InferenceGraph**

- Имя, labels.
- Router type: Sequence / Splitter / Ensemble / Switch.
- Steps: serviceName (хотя бы один), name, data, condition.
- CPU/Memory на spec графа.
- Advanced: min/max replicas.

**YAML** — весь манифест. JSON не принимается. Любые поля CR, которых нет в Fields (affinity, nodeSelector, logger…), задаются только так.

---

### A.5 Карточка deployment

**Что происходит:** GET одного CR. Пока грузится — spinner. 404/403 — Alert.

**Что нарисовано**

- Хлебные крошки и h1 = имя.
- Edit / Delete (только canEdit).
- Kind, Project, Model format (IS) / Graph «N nodes» (IG), Storage URI или Graph summary.
- Status (тот же Ready-чип).
- URL.
- Labels (`metadata.labels` чипами `key=value`).
- Created.
- Таблица всех `status.conditions` (Type, Status, Reason, Message) — здесь видно PredictorReady, RoutesReady и т.д., не только Ready.

**Что можно сделать:** прочитать здоровье и endpoint; Edit (та же модалка); Delete с возвратом на список. YAML на этой странице нет — только через Edit → YAML.

---

### A.6 Settings → KServe — общая рамка

Шаблоны runtime и storage initializer. Строка в Settings — не работающая модель и не имеет predict URL. Экземпляры появляются только после Create на Deployments.

При `/settings` и `/settings/kserve` сразу редирект на **Cluster serving runtimes**.

Шапка: заголовок KServe, описание, три таба. Под табами — description текущего kind, toolbar Create + Refresh, таблица.

Переключение таба сбрасывает открытые модалки create/edit/delete и меняет URL.

---

### A.7 Вкладка Cluster serving runtimes

Cluster-scoped runtime, виден всем проектам. Пишет только admin: правка образа затрагивает все IS, которые резолвятся в этот runtime. Pre-installed нельзя Edit/Delete — только Duplicate.

**Что происходит:** один cluster-wide `GET …/clusterservingruntimes`. Нет фильтра проекта.

**Что нарисовано у каждой строки**

- Имя (displayName из annotations, иначе metadata.name).
- Чип **Pre-installed**, если `nova-ai.io/pre-installed: "true"`.
- Чип движка **vllm** из ключа `vllm.version` (и любых `*.version`).
- Чип версии **v0.8.5**.
- Фиолетовый **Single-model** или **Multi-model** (`spec.multiModel`; это не число нод). Single-model = один IS → один runtime (обычный случай LLM/sklearn). Multi-model = один runtime обслуживает несколько моделей сразу (классический KFServing model mesh). HuggingFace на 4 GPU через workerSpec всё равно Single-model.
- Жёлтый **REST** и/или **gRPC** по `protocolVersions`.
- Kebab.

**Что можно сделать**

| | Pre-installed runtime | Обычный runtime |
|---|---|---|
| Клик по строке | открыть карточку (read-only) | открыть карточку |
| Duplicate | admin: копия `-copy` без pre-installed, сразу форма Create | нет |
| View / Edit / Delete | нет в kebab | View всем; Edit/Delete только admin |

Admin Create — модалка нового ClusterServingRuntime (см. A.10).  
Developer/viewer — только смотрят и открывают YAML на карточке. Create нет.

---

### A.8 Вкладка Cluster storage containers

ClusterStorageContainer матчит `storageUri` по prefix/regex (`hf://`, `s3://`, …) и задаёт init-контейнер загрузки. InferenceService указывает только URI. Несколько prefix/regex на одном контейнере допустимы.

Тот же cluster list, другая таблица: Name+чипы, URI formats, Containers, Created, kebab.

**Зачем пользователю:** понять, какие URI (`s3://`, `hf://`, regex azure/http) умеет initializer, каким образом качается модель для InferenceService.storageUri.

Сценарии как у cluster runtimes: admin CRUD; pre-installed только Duplicate; остальные View/Edit/Delete; клик → карточка с YAML.

---

### A.9 Вкладка Serving runtimes

Namespaced ServingRuntime: свой образ/args в одном проекте, cluster huggingfaceserver не меняется. IS в этом проекте может указать `runtime: <имя>` в Advanced — тогда KServe не берёт cluster-шаблон.

Namespaced аналог cluster runtimes: свои шаблоны **в проекте**, не трогая кластерные.

**Что происходит:** list ServingRuntime в каждом видимом проекте (admin — все Nova ns, contributor — bound). Сверху dropdown **Project** / All projects / Go to — как на Deployments.

**Что можно сделать**

- Смотреть runtimes всех своих проектов или одного.
- Contributor: Create/Edit/Delete **в своих** проектах (не pre-installed).
- Admin: то же во всех проектах + Duplicate cluster-подобных pre-installed, если они заведены как namespaced.
- Viewer: только смотреть.

Фиолетовый/жёлтый чипы и version/engine считаются так же, как у ClusterServingRuntime.

---

### A.10 Модалка Create / Edit / Duplicate runtime или storage

Image — контейнер сервера (vLLM, huggingfaceserver), не путь к весам. Веса задаются на Deployments в `storageUri`.

**Create {Kind}** — пустой шаблон.  
**Edit** — текущий объект, имя нельзя сменить.  
**Duplicate** — копия pre-installed: сняты uid/pre-installed label, имя `{base}-copy`, дальше как Create.

Режимы Fields | YAML.

**Runtime (cluster или namespaced), Fields — что можно задать**

1. Name, **Labels** (`metadata.labels`: сюда `vllm.version`, `nova-ai.io/pre-installed`).
2. **Spec labels** — на pod рантайма.
3. **Spec annotations** — например prometheus port/path (в шаблоне уже 8080 и `/metrics`).
4. Supported model formats (name/version/autoSelect/priority) — по ним KServe матчит InferenceService.
5. Protocol versions (v1/v2/grpc-v1/grpc-v2).
6. Секция **Containers** — карточка как у обычного контейнера: name (дефолт `containers`), image, args, command, env (value или fieldRef), resources (cpu/memory + Add resource для GPU), security context, volume mounts, три **скрытые** probes.
7. Volumes.
8. **Worker spec** (multi-node): pipelineParallelSize, tensorParallelSize, такие же карточки контейнеров и volumes. Нужно для huggingface multinode; не меняет чип Single-model.

Пробы свёрнуты. Раскрыть Liveness/Readiness/Startup → thresholds, exec.command списком argv (многострочный скрипт — один элемент), httpGet, tcpSocket, grpc. Если в CR уже были probes — секции сразу раскрыты.

Нельзя сохранить runtime без model format и без image хотя бы у одного контейнера.

**Storage container, Fields:** image initializer, URI prefix/regex (хотя бы один), workloadType initContainer|container. Нет spec labels/annotations.

YAML — полный CR, включая то, чего нет в Fields.

---

### A.11 Карточка Settings-ресурса

GET одного CR.

**Нарисовано:** breadcrumb KServe → kind → name; чипы Pre-installed / engine / version; Kind, Project (если namespaced), Created, model formats или URI formats, имена контейнеров, metadata labels, spec labels/annotations; ниже **весь YAML read-only**.

**Можно:** смотреть манифест; если не pre-installed и есть право писать — Edit (модалка) и Delete (confirm → возврат на список). Pre-installed на карточке без кнопок изменения.

---

### A.12 Типовые пользовательские потоки (только эти вкладки)

1. **Задеплоить sklearn в проект**  
   Settings не обязателен, если в кластере уже есть runtime под sklearn. Deployments → Create → InferenceService → format sklearn → storageUri → Save. Список показывает Unknown, пока KServe не проставит Ready; потом зелёный чип и URL.

2. **Задеплоить vLLM/huggingface, которого нет в cluster templates**  
   Admin: Settings → Cluster serving runtimes → Create (image, formats, `vllm.version`, probes) или Duplicate pre-installed и поправить. Затем Deployments → IS с format huggingface и опционально Advanced.runtime = имя этого runtime.

3. **Свой runtime только в одном проекте**  
   Contributor: Settings → Serving runtimes → выбрать свой Project → Create. Cluster templates не меняются. IS в этом проекте может указать `runtime: <это имя>`.

4. **Посмотреть, почему модель Not ready**  
   Deployments → клик по строке → таблица conditions (причина/message). Править spec — Edit.

5. **Снять модель**  
   kebab Delete или Delete на карточке. Runtime в Settings остаётся.

6. **Скопировать pre-installed huggingfaceserver**  
   Settings → kebab Duplicate у строки с чипом Pre-installed → форма копии → Save. Дальше это обычный редактируемый runtime.

7. **Пометить версию на runtime**  
   Edit → Labels → ключ `vllm.version`, значение `0.8.5` → после Refresh в списке чипы `vllm` и `v0.8.5`.

8. **Multi-node huggingface**  
   Settings runtime: Worker spec + parallel sizes + worker container с liveness/startup exec. Deployments IS: Advanced workerSpec те же числа (на стороне IS это `spec.predictor.workerSpec`).

9. **Только смотреть (viewer)**  
   Обе вкладки открываются (Settings всегда; Deployments при метке). Ничего нельзя сохранить/удалить. URL моделей открывается.

---

## 1. Deployments

### 1.1 Назначение экрана

Управление **развёрнутыми моделями** KServe в проектах пользователя: список, фильтрация, создание, правка, удаление, карточка ресурса. Визуально близко к ODH Model Serving: описание, фильтр Project, Go to project, одна кнопка Create Deployment.

Копирайт на странице: *«View and manage the health and performance of deployed models.»*

### 1.2 Когда вкладка видна

Sidebar-пункт **Deployments** и маршрут `/deployments/*` — feature flag `deployments`.

Флаг выставляется в `AuthToolbarItem` из `hasConsoleService(access, 'Deployments')`. Сервис включается меткой на **PlatformRole**:

```yaml
metadata:
  labels:
    nova-ai.io/deployments-enabled: "true"
```

Алиасы (нормализуются в `deployments`): `deployment`, `models`. Старый одиночный `nova-ai.io/console-service: deployments` тоже принимается, если значение без запятых.

Тот же флаг открывает вкладку **Deployments** внутри проекта (`/projects/:projectName/deployments`). Overview/Projects всегда доступны; Deployments — нет.

Расширения: `distributions/nova-ai/src/extensions.ts` (`id: deployments`, `flags.required: ['deployments']`).

Settings **не** гейтится этим флагом (см. §2).

### 1.3 Маршруты и файлы

| URL | Компонент | Назначение |
|---|---|---|
| `/deployments` | `DeploymentsPage` | глобальный список по всем доступным проектам |
| `/deployments/:namespace/:kind/:name` | `DeploymentDetails` | карточка |
| `/projects/:projectName/deployments` | тот же `DeploymentsPage` с `projectName` | список одного проекта, без Project dropdown |
| `/projects/:projectName/deployments/:kind/:name` | `DeploymentDetails projectScoped` | карточка с хлебными крошками Projects |

`kind` в URL — `InferenceService` или `InferenceGraph`.

Ключевые файлы:

```
distributions/nova-ai/src/pages/deployments/
  Deployments.tsx          # Routes
  DeploymentsPage.tsx      # список + kebab + create/edit/delete
  DeploymentDetails.tsx    # карточка + conditions
  ResourceFormModal.tsx    # форма Fields/YAML
  crdCatalog.ts            # каталог kind + пути API
  kserveApi.ts             # list/get/create/update/delete
  kserveHelpers.ts         # поля spec, status, labels
  manifest.ts              # YAML dump/parse (не js-yaml)
pages/projects/tabs/DeploymentsTab.tsx  # обёртка с projectName
```

### 1.4 Kubernetes-сущности

В таблице только InferenceService и InferenceGraph. Поды создаёт KServe; в UI их нет.

Только **два** kind, оба namespaced. Другие KServe CR (`LLMInferenceService`, `TrainedModel`, `LocalModelCache`, …) на вкладке **не** показываются.

| Kind | apiVersion | REST plural | Scope |
|---|---|---|---|
| `InferenceService` | `serving.kserve.io/v1beta1` | `inferenceservices` | Namespace |
| `InferenceGraph` | `serving.kserve.io/v1alpha1` | `inferencegraphs` | Namespace |

Путь коллекции:

```
/apis/{group}/{version}/namespaces/{ns}/{plural}
/apis/{group}/{version}/namespaces/{ns}/{plural}/{name}
```

Список строится **по каждому видимому проекту отдельно** (`Promise.all` kind × namespace). Кластерного list нет: developer не имеет list namespaces и не должен видеть чужие IS. Если list по namespace падает (403/404), этот namespace даёт `[]`, общая страница не валится.

Перед записью (`writable` в `kserveApi.ts`) с объекта снимаются:

- `status` (целиком — status только от контроллера);
- `metadata.managedFields`, `uid`, `creationTimestamp`, `generation`, `deletionTimestamp`;
- при create также `resourceVersion`.

Create = `POST` коллекции, update = `PUT` item (полный объект, не patch), delete = `DELETE`.

### 1.5 Что изображено на списке

Toolbar:

- **Create Deployment** — если `canCreate` (есть хотя бы один проект с `canEdit`). На глобальной странице без выбранного проекта берётся первый editable namespace; кнопка disabled, если editable namespace нет.
- **Refresh** — повторный list.

Фильтр проекта (только глобальный `/deployments`, не внутри project tab):

- dropdown **Project**: `All projects` + видимые namespaces;
- query `?project=<name>`;
- при выборе проекта — ссылка **Go to** `/projects/<name>/overview` с иконкой папки;
- колонка Project скрывается, если выбран конкретный проект.

Таблица (PatternFly compact, строка кликабельна → details):

| Колонка | Сортировка | Откуда данные |
|---|---|---|
| Name | да, `metadata.name` | `metadata.name` |
| Kind | да, title каталога | `InferenceService` / `InferenceGraph` |
| Project | нет | `metadata.namespace`; скрыта при фильтре проекта |
| Model format | нет | IS: `spec.predictor.model.modelFormat.name`, иначе первый ключ predictor кроме мета-ключей; IG: `—` |
| Status | нет | condition `type=Ready` (см. §1.6) |
| URL | нет | `status.url` / `status.address.url` / `status.components.predictor.url` |
| Created | да | `metadata.creationTimestamp`, `toLocaleString()` |
| kebab | — | View / Edit / Delete |

Сортировка по умолчанию: name asc. Направления asc/desc.

Kebab:

- **View** — переход на details;
- **Edit** — модалка формы; `isDisabled`, если `!canEdit` проекта;
- **Delete** — confirm modal; disabled без `canEdit`.

Клик по строке = View. Клик по URL останавливает bubbling (`stopPropagation`), открывает URL в новой вкладке.

Empty state: «No InferenceService or InferenceGraph…» + Create, если можно создавать.

Ошибка list — `Alert` danger. Ошибка delete/update — отдельный `actionError`.

### 1.6 Status (бывшее Ready)

Колонка раньше называлась Ready, теперь Status — смысл тот же: condition `Ready` от KServe (часто вместе с Knative). Пока качаются веса — False/Unknown, это не баг Refresh.

Не фаза Pod и не `status.modelStatus`. Берётся **только** Kubernetes condition:

```
resource.status.conditions.find(c => c.type === 'Ready')
```

| `condition.status` | Чип | Цвет Label |
|---|---|---|
| `True` | Ready | green |
| `False` | Not ready | red |
| нет Ready / иное | Unknown | grey |

Тот же чип на details. Полный набор conditions выводится таблицей на details: Type, Status, Reason, Message (`lastTransitionTime` только в key строки).

URL сервиса (`serviceUrl`):

1. `status.url`
2. иначе `status.address.url`
3. иначе `status.components.predictor.url`
4. иначе пусто → `—`

Это поля, которые заполняет KServe/Knative после того, как predictor поднялся. Консоль их не вычисляет.

### 1.7 Labels на Deployments

`metadata.labels` InferenceService/InferenceGraph. Не включают вкладки, не влияют на Status, не путать с `vllm.version` на runtime в Settings.

Редактируются как `metadata.labels` (не `spec.predictor.labels`). На details каждая пара `key=value` — compact Label. В форме — список Key/Value + Add label. Пустые ключи отбрасываются при save.

Метки **не** используются консолью для Status/Ready/URL. Это произвольные k8s labels на CR.

### 1.8 Форма Create / Edit (`ResourceFormModal`)

Режимы: **Fields** | **YAML**. Переключение Fields→YAML сериализует draft; YAML→Fields парсит кастомным парсером (`manifest.parseManifest`). JSON **запрещён** (ошибка «Use YAML»).

При Create (`allowKindSwitch`) сверху radio:

- InferenceService — «Deploy a single model.»
- InferenceGraph — «Route traffic across InferenceServices.»

Смена kind сбрасывает spec в `emptyResource`, имя и namespace сохраняются.

Если editable namespaces > 1 и страница не сужена одним проектом — dropdown **Project** (disabled при edit).

Имя: DNS-1123, `NAMESPACE_NAME_PATTERN`, max 63.

#### InferenceService — Fields

**Basic (всегда видно):**

| UI | JSON-путь |
|---|---|
| Name | `metadata.name` |
| Labels | `metadata.labels` |
| Model format (required) | `spec.predictor.model.modelFormat.name` — enum: sklearn, xgboost, tensorflow, pytorch, onnx, huggingface, mlflow, lightgbm, paddle, pmml, triton |
| Args (список) | `spec.predictor.model.args` |
| Env name/value (список) | `spec.predictor.model.env` |
| Model location XOR | `storageUri` **или** `storage.key`+`storage.path` |
| Storage URI | `spec.predictor.model.storageUri` |
| Storage key / path | `spec.predictor.model.storage.{key,path}` |
| CPU/Memory request & limit | `spec.predictor.model.resources.requests\|limits.{cpu,memory}` |
| Ports: containerPort, name, protocol | `spec.predictor.model.ports[]` |

XOR: при `uri` удаляется `spec.predictor.model.storage`; при `storage` удаляется `storageUri`. Валидация: format required; для uri — non-empty storageUri; для storage — non-empty key.

**Advanced (ExpandableSection, по умолчанию свёрнут):**

| UI | JSON-путь |
|---|---|
| Protocol version | `spec.predictor.model.protocolVersion` (`v1`, `v2`, `grpc-v1`, `grpc-v2`) |
| Runtime | `spec.predictor.model.runtime` — имя ServingRuntime/ClusterServingRuntime; пусто = KServe выберет по modelFormat |
| Min/Max replicas | `spec.predictor.minReplicas` / `maxReplicas` |
| Service account | `spec.predictor.serviceAccountName` |
| Image | `spec.predictor.model.image` |
| Worker spec: pipelineParallelSize, tensorParallelSize (≥ 1) | `spec.predictor.workerSpec.{pipelineParallelSize,tensorParallelSize}` |

Пустой `emptyResource` IS:

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: ''
  namespace: <project>
spec:
  predictor:
    minReplicas: 1
    model:
      modelFormat:
        name: sklearn
```

Остальные поля CR (affinity, nodeSelector, logger, canary, …) доступны **только в YAML**.

#### InferenceGraph — Fields

**Basic:**

| UI | JSON-путь |
|---|---|
| Name | `metadata.name` |
| Labels | `metadata.labels` |
| Router type (required) | `spec.nodes.root.routerType` — Sequence, Splitter, Ensemble, Switch |
| Steps (список) | `spec.nodes.root.steps[]`: `serviceName` (required хотя бы у одного), `name`, `data`, `condition` |
| CPU/Memory request & limit | `spec.resources.requests\|limits.{cpu,memory}` (на spec графа, не predictor) |

**Advanced:** minReplicas / maxReplicas на `spec.minReplicas` / `spec.maxReplicas`.

Пустой граф:

```yaml
spec:
  nodes:
    root:
      routerType: Sequence
      steps:
        - serviceName: ''
```

Неизвестные ключи шага сохраняются в `extra` и пишутся обратно (round-trip YAML↔fields).

### 1.9 Карточка deployment (details)

Хлебные крошки: Deployments → name, либо Projects → project → Deployments → name.

Поля:

- Kind, Project, Model format / Graph (для IG — «N nodes» по ключам `spec.nodes`);
- Storage URI (IS) или Graph summary (IG);
- Status (Ready condition);
- URL (ссылка);
- Labels;
- Created;
- таблица всех `status.conditions`. Если чип Not ready — сюда: Reason и Message обычно говорят «runtime not found», «Waiting for model», «RevisionFailed» и т.п.

Кнопки Edit/Delete только при `canEdit`. После delete — возврат на list.

YAML на details **нет** (в отличие от Settings). Полный манифест — через Edit → YAML.

### 1.10 Сценарии Deployments

1. **Нет метки deployments-enabled** — пункта Deployments в sidebar нет, `/deployments` не регистрируется, вкладки в проекте нет.
2. **Есть метка, пользователь viewer** — список/карточка видны в bound namespaces; Create скрыт; Edit/Delete disabled.
3. **Contributor, binding на один namespace** — видит только этот проект; Create пишет IS/IG туда; list других ns не вызывается.
4. **Admin** — видит все Nova-проекты; Create может выбрать любой editable (все) проект.
5. **Фильтр All projects / один project** — query `?project=`; колонка Project появляется/прячется; Go to project.
6. **Открыть из проекта** — `DeploymentsPage({ projectName })` без dropdown, create namespace фиксирован.
7. **Create IS Fields** — выбрать kind, project, format, storage XOR, save → POST namespaced inferenceservices.
8. **Create IG Fields** — routerType + хотя бы один step.serviceName.
9. **Create YAML** — вставить полный манифест; kind берётся из YAML; JSON отклонён.
10. **Edit** — PUT с resourceVersion; status не отправляется.
11. **Delete** — confirm → DELETE → refresh list / navigate away с details.
12. **Клик по строке** — details, не модалка.
13. **Сортировка** name / kind / created.
14. **Refresh** — повторный list без reload страницы.
15. **Ошибка list одного ns** — остальные проекты всё равно показываются.
16. **Нет Ready condition** — Status = Unknown, серый чип.
17. **IS Ready=True, url заполнен** — зелёный Ready, кликабельный URL.
18. **IS с кастомными labels** — видны на details и в форме.
19. **Переключение Fields↔YAML** — round-trip через `toManifest`/`parseManifest`; несохранённый YAML с ошибкой не пускает в Fields.
20. **WorkerSpec на IS** — Advanced, целые ≥ 1; прочие ключи workerSpec только YAML.
21. **Runtime пустой** — KServe сам подберёт ClusterServingRuntime/ServingRuntime по `supportedModelFormats` (это уже поведение контроллера, не UI).

---

## 2. Settings → KServe

### 2.1 Назначение экрана

Администрирование **рантаймов и storage initializer**, на которых поднимаются deployments. Правка образа ClusterServingRuntime затрагивает все IS, которые резолвятся в этот runtime:

- какие образы/args/probes использовать для huggingface, vLLM, sklearn, …;
- как скачивать модели (s3://, hf://, …);
- cluster-wide шаблоны vs project-scoped ServingRuntime.

Это **не** список задеплоенных моделей. Связь с Deployments: IS без `spec.predictor.model.runtime` резолвится KServe в ClusterServingRuntime/ServingRuntime по `supportedModelFormats`.

Это **не** список задеплоенных моделей. Связь с Deployments: IS без `spec.predictor.model.runtime` резолвится KServe в ClusterServingRuntime/ServingRuntime по `supportedModelFormats`.

### 2.2 Когда вкладка видна

Секция sidebar **Settings** и пункт **KServe** **всегда** зарегистрированы, без `flags.required` и без `nova-ai.io/settings-enabled`. Любой залогиненный пользователь с доступом к консоли видит Settings. Редактирование ограничено ролью (см. §2.10).

Заголовок страницы: *«KServe»* / *«View and configure serving runtimes and storage containers.»*

### 2.3 Маршруты и файлы

| URL | Компонент |
|---|---|
| `/settings` | redirect → `/settings/kserve` |
| `/settings/kserve` | redirect → `/settings/kserve/cluster-serving-runtimes` |
| `/settings/kserve/:tab` | список kind |
| `/settings/kserve/:tab/:name` | details cluster-scoped |
| `/settings/kserve/:tab/:namespace/:name` | details ServingRuntime |

`:tab`: `cluster-serving-runtimes` | `cluster-storage-containers` | `serving-runtimes`.

```
distributions/nova-ai/src/pages/settings/
  Settings.tsx
  kserve/KServeSettings.tsx      # три таба + таблицы + kebab
  kserve/ResourceDetails.tsx
  kserve/ResourceFormModal.tsx
  kserve/catalog.ts
  kserve/api.ts
  kserve/helpers.ts              # контейнеры, probes, labels, version tags
```

### 2.4 Kubernetes-сущности

Все `serving.kserve.io/v1alpha1`.

| Kind | plural | Scope | Кто пишет в UI |
|---|---|---|---|
| `ClusterServingRuntime` | `clusterservingruntimes` | Cluster | только `consoleRole === 'admin'` |
| `ClusterStorageContainer` | `clusterstoragecontainers` | Cluster | только admin |
| `ServingRuntime` | `servingruntimes` | Namespace | admin **или** contributor в проекте |

REST:

```
# cluster
/apis/serving.kserve.io/v1alpha1/clusterservingruntimes
/apis/serving.kserve.io/v1alpha1/clusterstoragecontainers
# namespaced
/apis/serving.kserve.io/v1alpha1/namespaces/{ns}/servingruntimes
```

Cluster list — один запрос на kind. ServingRuntime — list **по каждому** видимому проекту (admin: `listProjects()`, иначе `access.visibleProjects`). 403 по ns → `[]`.

`writable` дополнительно **удаляет `metadata.namespace`** у cluster kinds (иначе apiserver отвергнет).

CRD: `crds.yaml` в корне репозитория (ClusterServingRuntime, ServingRuntime, ClusterStorageContainer). UI не генерирует форму из OpenAPI; поля заданы вручную в форме. Всё, чего нет в Fields, доступно через YAML.

`disabled` на ServingRuntime (`spec.disabled`) и ClusterStorageContainer (`disabled` в корне CR) **в UI больше нет** — ни свитча, ни поля на details. Если поле есть в YAML кластера, оно сохранится при YAML-save, но форма его не редактирует.

### 2.5 Что изображено на списке

Три PatternFly Tabs в шапке. Под ними description текущего kind.

Для **Serving runtimes** — тот же Project dropdown + Go to project, что у Deployments (`?project=`). Cluster kinds фильтра проекта не имеют.

Toolbar: **Create {Kind}** (если можно) + **Refresh**.

#### Таблица ClusterServingRuntime / ServingRuntime (как ODH Serving runtimes)

| Колонка | Содержание |
|---|---|
| Name | displayName (см. §2.7) + чипы Pre-installed / engine / version / namespace |
| Serving platforms supported | фиолетовый Label: Single-model **или** Multi-model |
| API protocol | жёлтый Label REST и/или gRPC |
| kebab | зависит от pre-installed |

**Serving platforms не означает single-node/multi-node.** Это `spec.multiModel === true` → `Multi-model`, иначе `Single-model`. Многонодовый huggingface (`spec.workerSpec`) остаётся Single-model, пока `multiModel` не true.

API protocol: по `spec.protocolVersions[]`. Значения `grpc*` → gRPC, остальное → REST. Несколько чипов, если в списке и REST, и gRPC. Пустой spec читается как `['v1','v2']` → REST.

Сортировка: name, created (для storage table created есть в колонке; для runtime created не выведен отдельной колонкой, но sort created работает по timestamp).

#### Таблица ClusterStorageContainer

| Колонка | Содержание |
|---|---|
| Name | displayName + те же чипы |
| URI formats | `spec.supportedUriFormats[].prefix\|regex` через запятую |
| Containers | `spec.container.name` |
| Created | `metadata.creationTimestamp` |
| kebab | как у runtime |

Строка кликабельна → details.

Empty state + Create {Kind}.

### 2.6 Чипы: Pre-installed, engine, version

Читаются **только из меток/аннотаций**, не из image tag.

**Pre-installed** (серый compact Label без color):

```
metadata.labels['nova-ai.io/pre-installed'] === 'true'
```

Константа `PRE_INSTALLED_LABEL`. Другие метки (`opendatahub.io/managed` и т.п.) **не** учитываются.

Поведение kebab:

| | Pre-installed | Обычный |
|---|---|---|
| Duplicate | да, если `canCreate` | нет |
| View / Edit / Delete | нет | да; Edit/Delete disabled без права писать |

Pre-installed **нельзя править и удалять** в UI (`canEditItem` сразу false). Это шаблоны кластера.

**Version** (синий Label) и **engine** (teal Label):

Ищутся ключи в порядке:

1. `metadata.labels`
2. `spec.labels`
3. `metadata.annotations`

Ключ version, если:

- равен `version`, или
- оканчивается на `.version` (`vllm.version`), или
- оканчивается на `/version` (`app.kubernetes.io/version`).

Значение `0.8.5` показывается как `v0.8.5` (префикс `v` не дублируется).

Для ключа `*.version` префикс до `.version` → engine-чип:

```yaml
metadata:
  labels:
    nova-ai.io/pre-installed: "true"
    vllm.version: "0.8.5"
```

Чипы: `Pre-installed` · `vllm` · `v0.8.5`.

Несколько `*.version` → несколько уникальных engine (case-insensitive), version берётся у первой найденной записи.

### 2.7 Display name

Порядок fallback:

1. `metadata.annotations['nova-ai.io/display-name']`
2. `opendatahub.io/template-display-name`
3. `openshift.io/display-name`
4. `metadata.name`

На details заголовок — **kubernetes name**, не displayName. DisplayName используется в таблице.

### 2.8 Duplicate

`duplicateResource`:

- клонирует объект, снимает uid/resourceVersion/creationTimestamp/generation/managedFields/deletionTimestamp/status;
- удаляет label `nova-ai.io/pre-installed`;
- имя: `{base}-copy` (обрезается до 63), `base` без суффикса `-copy` / `-copy-N`;
- открывает **ту же форму Create**, не PUT оригинала.

Копия — обычный редактируемый ресурс.

### 2.9 Форма Settings (`kserve/ResourceFormModal`)

Fields | YAML, тот же YAML-парсер.

Общее:

- Name (DNS-1123, disabled при edit);
- Project — только ServingRuntime;
- **Labels** = `metadata.labels` (сюда же `nova-ai.io/pre-installed`, `vllm.version`);
- для runtime: **Spec labels** = `spec.labels` (попадают на pod serving runtime);
- для runtime: **Spec annotations** = `spec.annotations` (например prometheus).

Дефолт нового runtime:

```yaml
spec:
  annotations:
    prometheus.kserve.io/port: "8080"
    prometheus.kserve.io/path: /metrics
  supportedModelFormats:
    - name: ''
      version: ''
      autoSelect: true
      priority: 1
  protocolVersions: [v1, v2]
  containers:
    - name: containers
      args:
        - --model_name={{.Name}}
        - --model_dir=/mnt/models
        - --http_port=8080
```

Имя контейнера по умолчанию — **`containers`** (константа `DEFAULT_CONTAINER_NAME`), не `kserve-container`.

#### ClusterServingRuntime / ServingRuntime — Fields

- Spec labels / Spec annotations (key-value списки).
- **Supported model formats**: name, version, autoSelect, priority ≥ 1; хотя бы один с именем при save.
- **Protocol versions**: чекбоксы v1, v2, grpc-v1, grpc-v2.
- Секция **Containers** — карточки контейнеров:
  - name, image (required хотя бы у одного),
  - args, command (списки; command — textarea),
  - env (value **или** fieldRef `fieldPath`),
  - resources: таблица Resource / Request / Limit, Add resource (cpu, memory, кастом `nvidia.com/gpu`, …); пустые omit;
  - security context: allowPrivilegeEscalation, privileged, runAsNonRoot, drop capabilities;
  - volume mounts (name, mountPath);
  - **probes** — см. ниже.
- Volumes (emptyDir medium/sizeLimit).
- Секция **Worker spec** (multi-node, тот же layout, что Containers):
  - Pipeline parallel size, Tensor parallel size (целые ≥ 1) → `spec.workerSpec.pipelineParallelSize` / `tensorParallelSize`;
  - карточки worker containers (те же поля, включая probes); пустая карточка показывается сразу (`readContainersOrBlank`), в API не пишется, пока пользователь не тронул поля;
  - Add container;
  - Volumes → `spec.workerSpec.volumes`.

Worker spec **не** меняет чип Single-model/Multi-model.

#### Probes (liveness / readiness / startup)

Для huggingface-multinode обычно `exec` health_check.py, не HTTP `/health`. Failed probe → KServe не ставит Ready на InferenceService.

Свёрнуты (`ExpandableSection`). Раскрыты, если в CR уже есть объект probe (`readProbe` ставит `enabled: true`). Иначе скрыты, пока пользователь не раскроет.

Поля (полный Probe из CRD):

- failureThreshold, periodSeconds, successThreshold, timeoutSeconds, initialDelaySeconds, terminationGracePeriodSeconds;
- exec.command — **список argv**, каждый элемент textarea (многострочный скрипт = один элемент массива, как `|` в YAML);
- httpGet: path, port, host, scheme, headers[];
- tcpSocket: host, port;
- grpc: port, service.

Пустой probe не сериализуется. Свёрнутый, но заполненный — всё равно пишется.

#### ClusterStorageContainer — Fields

- один контейнер (`spec.container`, имя по умолчанию `storage-initializer`, image required);
- supportedUriFormats: prefix или regex, хотя бы один;
- workloadType: `initContainer` | `container` (`spec.workloadType`, default initContainer);
- без spec.labels/annotations (в CRD их нет — UI их не шлёт).

Дефолтные URI: s3://, gs://, hdfs://, webhdfs://, azure blob/file regex, http(s) regex, hf://.

YAML-save кладёт манифест as-is (после подстановки apiVersion/kind). Fields-save идёт через `prepareForSave` (strict: пустые контейнеры/форматы выкидываются).

### 2.10 Права на Settings

| Действие | ClusterServingRuntime / ClusterStorageContainer | ServingRuntime |
|---|---|---|
| List / View | любой, у кого list/get в RBAC (developer+viewer+admin) | в видимых проектах |
| Create / Edit / Delete | только UI-admin | UI admin или contributor **этого** проекта |
| Duplicate pre-installed | UI-admin (`canCreate` cluster) | contributor/admin с `canEdit` проекта |

`canEditSettingsKind(kind, consoleRole)`:

- ServingRuntime → admin \| contributor;
- cluster kinds → только admin.

Viewer: видит cluster runtimes (get/list), kebab без Duplicate если `!canCreate`, Edit/Delete disabled; для не-pre-installed всё равно есть View.

### 2.11 Карточка Settings resource

Чипы Pre-installed / engine / version как в таблице.

Description list:

- Kind, Project (если namespaced), Created;
- Storage: Workload type, URI formats;
- Runtime: Model format (`name:version` через запятую);
- Containers (имена);
- Labels (`metadata.labels`);
- Spec labels / Spec annotations (не для storage).

Ниже **read-only YAML** всего объекта (`toManifest`).

Edit/Delete на details только если `canEdit` (не pre-installed).

### 2.12 Сценарии Settings

1. **Открыть Settings** — любой пользователь консоли, без deployments-enabled.
2. **Три таба** — переключение сбрасывает create/edit/delete state, меняет URL.
3. **Admin смотрит Cluster serving runtimes** — list cluster CR; Create; pre-installed → только Duplicate; остальные → View/Edit/Delete.
4. **Developer смотрит cluster runtimes** — list (RBAC get/list); Create нет; kebab у pre-installed пустой; у своих нет, у чужих cluster — View (Edit disabled).
5. **Contributor ServingRuntime в своём ns** — list только bound ns; Create ServingRuntime; полный kebab на не-pre-installed.
6. **ServingRuntime All projects / один project** — как Deployments, `?project=`.
7. **Создать runtime Fields** — name, labels, spec annotations prometheus, model formats, protocol, container image, save → POST.
8. **Создать runtime YAML** — полный манифест ClusterServingRuntime.
9. **Поставить version-чип** — `metadata.labels['vllm.version']="0.8.5"` (или `spec.labels`) → чипы vllm + v0.8.5 после Refresh.
10. **Pre-installed шаблон** — label `nova-ai.io/pre-installed=true`; Duplicate снимает её и даёт имя `-copy`.
11. **Редактировать probes** — раскрыть Liveness, заполнить exec command argv (`bash`, `-c`, скрипт), thresholds; свернуть; save сохраняет.
12. **Multi-node worker** — заполнить pipeline/tensor parallel и worker container (image, probes как у huggingface health_check); `spec.workerSpec` появляется в YAML.
13. **Custom GPU** — Add resource `nvidia.com/gpu` request/limit.
14. **Storage container** — URI prefix/regex + image initializer.
15. **Удаление** — confirm modal, нельзя для pre-installed.
16. **Клик по строке** — details с YAML, не overlay.
17. **Ошибка save** — Alert с текстом K8s Status.message.
18. **YAML с dotted keys** (`vllm.version`, `prometheus.kserve.io/path`) — кастомный парсер хранит ключ целиком, не разворачивает точки в вложенность.
19. **Пустой worker container на форме** без правок — в кластер `workerSpec.containers` не уходит.
20. **Display name** — annotation перекрывает metadata.name только в таблице.

---

## 3. Связь Deployments ↔ Settings

Связь не кнопкой в списке Deployments:

1. Settings: runtime с `supportedModelFormats` (например `huggingface`).
2. Deployments: IS с `modelFormat.name: huggingface` **или** Advanced `runtime: <имя>`.
3. После POST контроллер KServe резолвит runtime и ClusterStorageContainer.
4. Когда predictor готов — `status.conditions[Ready]` и `status.url`. Консоль перечитывает это по Refresh.

Консоль **не** подставляет runtime в форму и **не** проверяет при Save, что format есть в каком-то runtime. Сохранить IS с неизвестным format можно — Ready не станет True.

```
PlatformRole
  nova-ai.io/deployments-enabled: "true"  →  sidebar Deployments
Settings (всегда)                         →  ClusterServingRuntime / ServingRuntime / ClusterStorageContainer

InferenceService.spec.predictor.model
  modelFormat.name  ──резолв KServe──►  ServingRuntime/ClusterServingRuntime.supportedModelFormats
  runtime           ──опциональный пин──► metadata.name рантайма
  storageUri        ──скачивание──►     ClusterStorageContainer.supportedUriFormats
```

Ожидаемый операционный поток:

1. Admin в Settings заводит/правит ClusterServingRuntime (vLLM image, probes, `vllm.version`, pre-installed).
2. Admin заводит ClusterStorageContainer под `s3://` / `hf://`.
3. Пользователь с deployments-enabled создаёт InferenceService: format `huggingface`, storageUri `hf://…`.
4. KServe выбирает runtime, поднимает pods, пишет `status.conditions[Ready]` и `status.url`.
5. Deployments показывает Status/URL.

---

## 4. Ограничения текущей реализации (для доработки)

Имеет смысл не ломать их молча:

- Нет watch/websocket: список обновляется только Refresh / после save/delete.
- Нет пагинации на Deployments/Settings (в отличие от Projects).
- Нет LLMInferenceService / TrainedModel / LocalModelCache на UI.
- Status deployments = только Ready condition; `PredictorReady`, `RoutesReady`, replica counts не отображаются отдельными колонками (они есть в таблице conditions на details).
- Serving platform ≠ node count; multi-node кодируется `spec.workerSpec`, не чипом.
- YAML-парсер самописный: нет якорей, merge keys, JSON, многодокументного `---`.
- Proxy использует kubeconfig из `.env`, не impersonate OIDC user (пока apiserver не научат StarVault trust).
- ClusterStorageContainer.disabled и ServingRuntime.spec.disabled сознательно убраны из UI.
- Имя контейнера по умолчанию `containers` — это UI-дефолт, не требование CRD.

---

## 5. Карта кода для правок

| Задача | Куда смотреть |
|---|---|
| Новый kind на Deployments | `crdCatalog.ts` KIND_CATALOG + форма + RBAC clusterroles.yaml |
| Новая колонка списка IS | `DeploymentsPage.tsx` + helper в `kserveHelpers.ts` |
| Status/URL | `readyStatus`, `serviceUrl` |
| Поля IS/IG формы | `ResourceFormModal.tsx` deployments + `kserveHelpers.ts` |
| YAML round-trip | `manifest.ts` |
| Новый Settings kind | `settings/kserve/catalog.ts` + `api.ts` collectionPath |
| Чипы version/pre-installed | `isPreInstalled`, `runtimeVersionTag`, `runtimeEngineTags` |
| Форма контейнера/probe | `settings/kserve/ResourceFormModal.tsx`, `helpers.ts` ProbeDraft |
| Кто может Create | `canCreate` в KServeSettings / DeploymentsPage + `canEditSettingsKind` |
| Видимость sidebar Deployments | `extensions.ts` flags + `nova-ai.io/deployments-enabled` |
| Proxy/ошибки k8s | `k8sClient.ts`, `k8sProxy.js` |
