<template>
  <NuxtPwaManifest />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!--
    PWA update prompt. Hidden until `$pwa.needRefresh` is true AND
    useAppUpdate() finds a newer /version.json. $pwa is client-only,
    so we wrap in <ClientOnly> to avoid SSR access.
  -->
  <ClientOnly>
    <PwaUpdatePrompt />
  </ClientOnly>
</template>
