import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
}

// Ключ ИИ в APK НЕ вшивается: каждый вставляет свой при первом запуске.
// Подпись: android/keystore.properties (в git не попадает). Нет файла — сборка подписывается отладочным ключом.
val ks = Properties().apply { File(rootDir, "keystore.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }

android {
    namespace = "com.burmaldets.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.burmaldets.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "3.1"
        // только для проверки на эмуляторе: ./gradlew assembleRelease -PwebDebug=true
        buildConfigField("boolean", "WEB_DEBUG", if (project.hasProperty("webDebug")) "true" else "false")
    }

    signingConfigs {
        if (ks.getProperty("storeFile") != null) create("release") {
            storeFile = file(ks.getProperty("storeFile"))
            storePassword = ks.getProperty("storePassword")
            keyAlias = ks.getProperty("keyAlias")
            keyPassword = ks.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.exifinterface:exifinterface:1.4.1")
    implementation("com.alphacephei:vosk-android:0.3.75")
    implementation("net.java.dev.jna:jna:5.17.0@aar")
}
