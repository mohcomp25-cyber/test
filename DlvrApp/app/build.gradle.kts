plugins {
    id("com.android.application")
}

android {
    namespace = "com.dlvr.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dlvr.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

dependencies {
    implementation("com.herohan:UVCCamera:1.0.3")
    implementation("androidx.appcompat:appcompat:1.6.1")
}
