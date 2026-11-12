import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
	manifest: {
		browser_specific_settings: {
			gecko: {
				data_collection_permissions: {
					required: ["none"],
				},
				id: "rcfy@thea.pet",
			},
		},
		default_locale: "en",
		description: "__MSG_extensionDescription__",
		host_permissions: ["*://www.reddit.com/"],
		name: "__MSG_extensionName__",
		optional_host_permissions: ["https://*/*"],
		optional_permissions: ["tabs"],
		permissions: ["storage"],
	},
	manifestVersion: 3,
	modules: [
		"@wxt-dev/auto-icons",
		"@wxt-dev/i18n/module",
		"@wxt-dev/module-react",
	],
	srcDir: "src",
	vite: () => ({
		plugins: [tailwindcss()],
	}),
});
