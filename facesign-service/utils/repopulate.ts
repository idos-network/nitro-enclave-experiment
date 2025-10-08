//
// This script is used to repopulate the 3d-db with users from our own DB
//

import { FACETEC_DEVICE_KEY, GROUP_NAME } from "../env.ts";
import { enrollUser } from "../providers/api.ts";
import { getMembers } from "../providers/db.ts";

async function repopulate3dDb() {
	const members = await getMembers(GROUP_NAME);
	console.log(`Repopulating 3d-db with ${members.length} users...`);

	for (const member of members) {
		try {
			await enrollUser(member, GROUP_NAME, FACETEC_DEVICE_KEY);
			console.log(`Enrolled user ${member} into 3d-db`);
		} catch (err) {
			console.error(`Failed to enroll user ${member}:`, err);
		}
	}

	console.log("Repopulation complete.");
}

repopulate3dDb();
