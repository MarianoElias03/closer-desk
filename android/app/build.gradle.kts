import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Deploy-specific values (never committed): local.properties locally, env vars in CI.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun setting(env: String, prop: String, fallback: String) =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: localProps.getProperty(prop, fallback)

android {
    namespace = "app.closerdesk"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.closerdesk"
        minSdk = 29
        targetSdk = 35
        // CI run number keeps versionCode rising so each release installs over the last one
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "${System.getenv("CD_VERSION_BASE") ?: "0.1"}." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0-dev")
        // the server the sign-in screen starts on (you can change it there)
        buildConfigField("String", "DEFAULT_SERVER", "\"${setting("CD_SERVER_URL", "closer.serverUrl", "")}\"")
    }

    signingConfigs {
        create("release") {
            val ksPath = setting("CD_KEYSTORE", "closer.keystore", "")
            val ksPass = setting("CD_KEYSTORE_PASSWORD", "closer.keystorePassword", "")
            if (ksPath.isNotBlank() && ksPass.isNotBlank()) {
                storeFile = rootProject.file(ksPath)
                storePassword = ksPass
                keyAlias = setting("CD_KEY_ALIAS", "closer.keyAlias", "closerdesk")
                keyPassword = ksPass
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingConfigs.getByName("release").storeFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
