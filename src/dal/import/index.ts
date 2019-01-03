import fetch from 'node-fetch';
import { ISpecDocument, ICFAssociation } from './interfaces';
import { IClaim, ClaimExpansion } from '../../models/claim';
import { IDOK, ITaskModel } from '../../models/target';

// This is required for translating specDocuments to an IClaim type
// tslint:disable:no-unsafe-any no-any

enum Subject {
  ELA = 'English Language Arts',
  MATH = 'Math'
}
const docs: string[] = [
  'smarter_balanced_ela_content_specification',
  'air_deprecated_ela_claims_and_targets',
  'air_deprecated_math_claims_and_targets',
  'ccss_imported_from_digital_library',
  'common_core_state_standards_for_ela',
  'common_core_state_standards_for_mathematics',
  'item_type_response_type',
  'major_vs__additional_supporting__math_',
  'major_vs__additional_supporting__math_',
  'smarter_balanced_math_content_specification',
  'norm_webb_s_depth_of_knowledge__dok__levels_of_cognitive_difficulty'
];

const docArr: ISpecDocument[] = [];
const docNames: string[] = [];
// tslint:disable:max-func-body-length
/**
 * Migrates CASE API documents into a new data model, an array
 * of IClaim objects.
 * @export
 * @returns {Promise<IClaim[]>}
 */
export async function importDbEntries(): Promise<IClaim[]> {
  let dokSpec: ISpecDocument;
  let claim: any = {};
  const claimArray: IClaim[] = [];
  const specifications: ISpecDocument[] = [];
  await importDocs(specifications);
  const specs = specDocs();
  const ELASpec: ISpecDocument = specs[0];
  const MATHSpec: ISpecDocument = specs[1];
  const DOKDOC: ISpecDocument = specs[2];

  specifications.forEach(specification => {
    claim = {};
    // special case for one bug in the CASE API
    if (specification.CFDocument.subject === undefined) {
      claim.subject = Subject.ELA;
    } else {
      claim.subject = specification.CFDocument.subject[0];
    }
    claim.title = specification.CFDocument.title;
    claim.grades = [];
    // special case for high-school multi-grades (e.g: 09, 10, 11, 12)
    if (specification.CFItems[0].educationLevel.length > 1) {
      specification.CFItems[0].educationLevel.forEach((edu: string) =>
        claim.grades.push(`${parseInt(edu, 10)}`)
      );
    } else {
      claim.grades[0] = `${parseInt(specification.CFItems[0].educationLevel[0], 10)}`;
    }
    claim.claimNumber = getClaim(claim.title, claim.subject, claim.grades);
    claim.target = [{}];
    if (claim.title.includes('Performance')) {
      while (claim.claimNumber.charAt(0) === 'C') {
        claim.claimNumber = claim.claimNumber.substr(1);
      }
      claim.target[0].interactionType = 'PT';
    }
    claim.shortCode = getClaimShortCode(claim.subject, claim.claimNumber, claim.grades);
    if (!claim.title.includes('Performance')) {
      claim.description = getClaimDesc(claim.subject, claim.shortCode, ELASpec, MATHSpec);
      if (claim.subject !== Subject.MATH && !claim.title.includes('Performance')) {
        claim.domain = [];
        claim.domain.push({
          title: getClaimDomain(claim.shortCode, ELASpec)
        });
      }
    }
    if (claim.shortCode.includes('-')) {
      claim.domain = [];
      for (const item of specification.CFItems) {
        if (
          item.CFItemType === 'Domain' ||
          item.abbreviatedStatement === 'Primary Content Domain' ||
          item.abbreviatedStatement === 'Secondary Content Domain'
        ) {
          if (item.abbreviatedStatement === undefined) {
            claim.domain.push({
              title: item.fullStatement
            });
          } else {
            claim.domain.push({
              title: item.abbreviatedStatement,
              desc: item.fullStatement
            });
          }
        }
      }
      getMultiTarget(specification, claim, DOKDOC);
    } else {
      claim.target[0].title = specification.CFDocument.title;
      claim.target[0].shortCode = getTargetShortCode(specification);

      getTarget(claim, specification, DOKDOC);
      specification.CFDocument.creator.split(' ')
        .filter((interactionType: string) => interactionType.includes('CAT'))
        .forEach((interactionType: string) => (claim.target[0].interactionType = interactionType));

      if (claim.subject === Subject.ELA) {
        dokSpec = ELASpec;
      } else {
        dokSpec = MATHSpec;
      }
      let uriString: string[];
      claim.target[0].DOK = [];
      for (const association of dokSpec.CFAssociations) {
        if (association.originNodeURI.title.includes(claim.target[0].shortCode)) {
          if (association.destinationNodeURI.uri.includes('DOK')) {
            uriString = association.destinationNodeURI.uri.split('DOK:');
            const uri = uriString[1].replace('%20', '');
            if (claim.target[0].DOK.length === 0) {
              claim.target[0].DOK.push({
                dokCode: uri
              });
            } else if (!claim.target[0].DOK.find((dok: IDOK) => dok.dokCode.includes(uri))) {
              claim.target[0].DOK.push({ dokCode: uri });
            }
          }
        }
      }
      claim.target[0].DOK.forEach((dok: IDOK) => {
        for (const item of DOKDOC.CFItems) {
          if (item.humanCodingScheme === dok.dokCode) {
            dok.dokDesc = item.fullStatement;
            dok.dokShort = item.abbreviatedStatement;
          }
        }
      });
    }
    pushToClaimArray(claimArray, claim, specification);
  });

  return consolidate(claimArray);
}

/**
 * Merges split multi-targets into the main IClaim array
 * @export
 * @param {IClaim[]} claimArray
 * @param {IClaim} newClaim
 * @param {ISpecDocument} claim
 */
export function pushToClaimArray(claimArray: IClaim[], newClaim: IClaim, claim: ISpecDocument) {
  let tempClaim: IClaim;
  if (newClaim.target[0].title.includes('Targets ')) {
    const tNum = parseInt(newClaim.target[0].title.split(' Targets ')[1].split('a')[0], 10);
    const tCode = `${newClaim.target[0].shortCode.split(`T${tNum}a`)[0]}T${tNum}b`;
    const targIdx = claim.CFItems.findIndex(i => i.humanCodingScheme === tCode);
    const endTarg = claim.CFItems[targIdx];
    newClaim.target[0].title = `${newClaim.target[0].title.split(' Targets ')[0]} Target ${tNum}a`;
    tempClaim = JSON.parse(JSON.stringify(newClaim));
    tempClaim.target[0].shortCode = endTarg.humanCodingScheme;
    tempClaim.target[0].description = endTarg.fullStatement;
    tempClaim.target[0].title = `${tempClaim.target[0].title.split(' Target ')[0]} Target ${tNum}b`;
    claimArray.push(tempClaim);
  }
  claimArray.push(newClaim);
}

/**
 * Translates target information from multi-grade-and-claim documents
 * @export
 * @param {ISpecDocument} claim
 * @param {*} newClaim
 * @param {ISpecDocument} DOKDOC
 */
export function getMultiTarget(claim: ISpecDocument, newClaim: any, DOKDOC: ISpecDocument) {
  const taskModels: ITaskModel[] = [];
  const titles: string[] = [];

  for (const i of claim.CFItems) {
    if (i.CFItemType === 'Target' && i.abbreviatedStatement.includes('Target ')) {
      titles.push(i.abbreviatedStatement);
      newClaim.target.push({
        title: `${i.CFDocumentURI.title}, ${i.abbreviatedStatement}`,
        shortCode: i.humanCodingScheme,
        description: i.fullStatement,
        taskModels: [],
        DOK: []
      });
    }
  }

  for (let i = 0; i < claim.CFItems.length; i++) {
    const exampleArr = [];
    if (
      claim.CFItems[i].CFItemType === 'Task Model' &&
      claim.CFItems[i].abbreviatedStatement === undefined
    ) {
      for (let j = i + 1; j < claim.CFItems.length; j++) {
        if (claim.CFItems[j].CFItemType === 'Example') {
          exampleArr.push(claim.CFItems[j].fullStatement);
        } else if (claim.CFItems[j].CFItemType === 'Task Model') {
          break;
        }
      }
      taskModels.push({
        taskName: claim.CFItems[i].fullStatement,
        taskDesc: claim.CFItems[i + 1].fullStatement,
        examples: exampleArr
      });
    }
  }

  for (const target of newClaim.target) {
    let iter = 0;
    target.taskModels = [];
    let tSplit;
    for (const task of taskModels) {
      if (target.title !== undefined && !target.shortCode.includes('M.GHS')) {
        tSplit = target.title.split(', ')[2];
        const code = `${newClaim.claimNumber.slice(1)}${tSplit.replace('Target ', '')}`;
        if (task.taskName.split('.')[0].includes(code)) {
          target.taskModels.push({
            taskName: task.taskName,
            taskDesc: task.taskDesc,
            examples: [task.examples]
          });
          iter++;
        }
      } else {
        target.taskModels.push(task);
      }
    }
  }

  for (const target of newClaim.target) {
    for (const association of claim.CFAssociations) {
      for (const item of DOKDOC.CFItems) {
        if (
          association.originNodeURI.title === target.shortCode &&
          association.destinationNodeURI.identifier === item.identifier
        ) {
          target.DOK = [];
          target.DOK.push({
            dokCode: item.humanCodingScheme,
            dokDesc: item.fullStatement,
            dokShort: item.abbreviatedStatement
          });
        }
      }
    }
  }
  newClaim.target.shift();
}

/**
 * Extracts the target-specific shortcode from one of a document's items
 * @export
 * @param {ISpecDocument} claim
 * @returns {(string | undefined)}
 */
export function getTargetShortCode(claim: ISpecDocument): string | undefined {
  for (const item of claim.CFItems) {
    if (item.CFItemType === 'Target' && item.humanCodingScheme !== undefined) {
      return item.humanCodingScheme;
    }
  }
}

/**
 * Extracts the claim shortcode in Subject.Grade.Claim format from a document's title
 * @export
 * @param {string} subject
 * @param {string} claim
 * @param {string[]} grade
 * @returns
 */
export function getClaimShortCode(subject: string, claim: string, grade: string[]) {
  const gradeLevel: string | string[] = parseInt(grade[0], 10) > 8 ? 'HS' : grade;
  if (grade.length > 1) {
    if (parseInt(grade[0], 10) < 9) {
      return subject === Subject.ELA
        ? `E.G${grade[0]}-${grade[grade.length - 1]}.${claim}`
        : `M.G${grade[0]}-${grade[grade.length - 1]}.${claim}`;
    }
  }

  return subject === Subject.ELA ? `E.G${gradeLevel}.${claim}` : `M.G${gradeLevel}.${claim}`;
}

/**
 * Extracts the claim number from a document's title in CX format (e.g C1, C2, C3)
 * See Data Structure docs for info on the differences between document titles
 * (https://github.com/osu-cass/SB-CSE-Data-Structure)
 * @export
 * @param {string} title
 * @param {string} subject
 * @param {string[]} grades
 * @returns
 */
export function getClaim(title: string, subject: string, grades: string[]) {
  let titlecopy = ` ${title}`.slice(1);
  let titlearray = [];
  if (subject === Subject.ELA) {
    if (!title.includes('Performance')) {
      titlearray = titlecopy.split(' ');

      return `C${titlearray[7]}`;
    }
    titlecopy = titlecopy.replace('English Language Arts Performance Task Specification: ', '');
    titlecopy = titlecopy.replace('Grade ', '');

    titlecopy = titlecopy.replace(grades[0], '');
    titlecopy = titlecopy.replace(' ', '');

    return `C${titlecopy}`;
  }
  titlearray = titlecopy.split(' ');
  if (title.includes('Grade ')) {
    return titlearray[5];
  }
  if (title.includes('Grades ')) {
    return `C${titlearray[4]}`;
  }
  if (title.includes('Mathematics ')) {
    return titlearray[4];
  }

  return `C${titlearray[4]}`;
}

/**
 * Fetches all the data for each document supplied from fetchAllDocs()
 * @export
 * @param {ISpecDocument[]} arr
 * @returns {number}
 */
export async function importDocs(arr: ISpecDocument[]): Promise<number> {
  const identifiers: string[] = await fetchAllDocs();
  for (const id of identifiers) {
    const data = await fetch(`https://case.smarterbalanced.org/ims/case/v1p0/CFPackages/${id}`);
    const jsonData: ISpecDocument = await data.json();
    const title: string = jsonData.CFDocument.title;
    const filename: string = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    if (!docs.includes(filename)) {
      arr.push(jsonData);
    } else {
      docNames.push(filename);
      docArr.push(jsonData);
    }
  }

  return identifiers.length;
}

/**
 * Fetches the Identifiers for every document in the CASE DB
 * @export
 * @returns
 */
export async function fetchAllDocs(): Promise<string[]> {
  const identifiers: string[] = [];
  const temp = await fetch(
    'https://case.smarterbalanced.org/ims/case/v1p0/CFDocuments?limit=99999999999&offset=0&sort&orderBy&filter&fields'
  );
  const idDoc = await temp.json();
  for (const document of idDoc.CFDocuments) {
    identifiers.push(document.identifier);
  }

  return identifiers;
}

/**
 * Maps Depth-of-knowledge and standards documents
 * @export
 * @returns {ISpecDocument[]}
 */
export function specDocs(): ISpecDocument[] {
  const specs: ISpecDocument[] = [];
  for (let i = 0; i < docNames.length; i++) {
    if (docNames[i].includes('smarter_balanced_ela_content_specification')) {
      specs[0] = docArr[i];
    } else if (docNames[i].includes('smarter_balanced_math_content_specification')) {
      specs[1] = docArr[i];
    } else if (
      docNames[i].includes('norm_webb_s_depth_of_knowledge__dok__levels_of_cognitive_difficulty')
    ) {
      specs[2] = docArr[i];
    }
  }

  return specs;
}

/**
 *  Extracts target-specific data for a given document
 * @export
 * @param {IClaim} claim
 * @param {ISpecDocument} jsonData
 * @param {ISpecDocument} DOKDOC
 */
export function getTarget(claim: IClaim, jsonData: ISpecDocument, DOKDOC: ISpecDocument): void {
  if (claim.shortCode.includes('M.GHS.C') && !claim.shortCode.includes('C1')) {
    getMultiTarget(jsonData, claim, DOKDOC);
  } else {
    for (const target of claim.target) {
      let iter = 0;
      target.taskModels = [];
      target.stem = [];
      target.standards = [];
      target.evidence = [];
      target.rubrics = [];
      for (const p of jsonData.CFItems) {
        const { fullStatement, humanCodingScheme, abbreviatedStatement } = p;
        if (
          p.CFItemType === 'Measured Skill' &&
          !target.standards.find(s => s.stdCode === humanCodingScheme)
        ) {
          target.standards.push({
            stdCode: humanCodingScheme,
            stdDesc: fullStatement
          });
        }
        if (p.CFItemType === 'Target' && p !== jsonData.CFItems[jsonData.CFItems.length - 1]) {
          target.description = fullStatement;
        }
        if (p.CFItemType === 'Clarification') {
          target.clarification = fullStatement;
        }
        if (p.CFItemType === 'Section Heading') {
          target.heading = fullStatement;
        }
        const splitStatement = fullStatement.split(' ');
        if (p.CFItemType === 'Evidence Required' && splitStatement.length > 2) {
          target.evidence.push({
            evTitle: abbreviatedStatement,
            evDesc: fullStatement
          });
        }
        // Special case in the CASE API where some CFItems are missing their CFItemType property
        if (
          p.abbreviatedStatement !== undefined &&
          p.CFItemType === undefined &&
          p.abbreviatedStatement.includes('Evidence Required ')
        ) {
          target.evidence.push({
            evTitle: abbreviatedStatement,
            evDesc: fullStatement
          });
        }

        if (p.CFItemType === 'Accessibility') {
          target.accessibility = fullStatement;
        }
        if (p.CFItemType === 'Task Model' && p.fullStatement.includes('Task Model ')) {
          target.taskModels.push(getTaskModel(p.identifier, jsonData, p.fullStatement));
        }
        if (p.CFItemType === 'Stem') {
          target.stem.push({
            stemDesc: fullStatement,
            shortStem: abbreviatedStatement
          });
        }
        iter++;
      }
    }
  }
  getAssociatedEvidence(claim, jsonData);
  getGenReqs(claim, jsonData);
}

/**
 * Builds the Related Evidence for Task Models
 * @export
 * @param {IClaim} claim
 * @param {ISpecDocument} jsonData
 */
export function getAssociatedEvidence(claim: IClaim, jsonData: ISpecDocument): void {
  const taskAssociations = jsonData.CFAssociations.filter(
    association =>
      association.originNodeURI.title.includes('Task Model ') &&
      association.destinationNodeURI.title.includes('Evidence Required ')
  );

  for (const taskModel of claim.target[0].taskModels) {
    taskModel.relatedEvidence = [];
    for (const taskAssociation of taskAssociations) {
      if (taskAssociation.originNodeURI.title === taskModel.taskName) {
        taskModel.relatedEvidence.push(taskAssociation.destinationNodeURI.title);
      }
    }
  }
}

/**
 * Extracts the target properties that are found under the "General Requirements" item types in a given document
 * @export
 * @param {IClaim} claim
 * @param {ISpecDocument} jsonData
 */
export function getGenReqs(claim: IClaim, jsonData: ISpecDocument): void {
  for (const item of jsonData.CFItems) {
    if (item.CFItemType === 'General Requirements') {
      if (item.abbreviatedStatement === 'Key/Construct Relevant Vocabulary') {
        claim.target[0].vocab = item.fullStatement;
      }
      if (item.abbreviatedStatement === 'Allowable Tools') {
        claim.target[0].tools = item.fullStatement;
      }
      if (item.abbreviatedStatement === 'Stimuli/Passages') {
        claim.target[0].stimInfo = item.fullStatement;
      }
      if (item.abbreviatedStatement === 'Stimuli/Text Complexity') {
        claim.target[0].complexity = item.fullStatement;
      }
      if (item.abbreviatedStatement === 'Development Notes') {
        claim.target[0].devNotes = item.fullStatement;
      }
      if (item.abbreviatedStatement === 'Dual-Text Stimuli') {
        claim.target[0].dualText = item.fullStatement;
      }
    }
  }
}

/**
 * returns the domain for a given ELA document.
 *
 * @param {string} subject
 * @param {string} shortCode
 * @param {ISpecDocument} ELASpec
 * @returns {(string | undefined)}
 */
function getClaimDomain(shortCode: string, ELASpec: ISpecDocument): string | undefined {
  let statement: string | undefined;
  for (let i = 0; i < ELASpec.CFItems.length; i++) {
    if (ELASpec.CFItems[i].humanCodingScheme === shortCode) {
      if (ELASpec.CFItems[i + 1].CFItemType === 'Domain') {
        statement = ELASpec.CFItems[i + 1].fullStatement;
      }
    }
  }

  return statement;
}

/**
 * Finds and returns the description for a given claim
 * @param {string} subject
 * @param {string} shortCode
 * @param {ISpecDocument} ELASpec
 * @param {ISpecDocument} MATHSpec
 * @returns {(String || undefined)}
 */
function getClaimDesc(
  subject: string,
  shortCode: string,
  ELASpec: ISpecDocument,
  MATHSpec: ISpecDocument
): string | undefined {
  const jsonData: ISpecDocument = subject === Subject.ELA ? ELASpec : MATHSpec;
  let code: string | string[] = shortCode;
  let gradeChars;
  if (shortCode.includes('-')) {
    gradeChars = shortCode.split('.')[1].split('')[1];
    code = shortCode.split('.');
    code = `${code[0]}.G${gradeChars}.${code[2]}`;
  }
  for (const item of jsonData.CFItems) {
    if (item.humanCodingScheme === code) {
      return item.fullStatement;
    }
  }
}

/**
 *  Merges all targets that share the same claim number into a singular claim object with an array of targets.
 * @export
 * @param {IClaim[]} claimArray
 * @returns {IClaim[]}
 */
export function consolidate(claimArray: IClaim[]): IClaim[] {
  let tempArray = [];
  let claimHolder;
  let finalArray: IClaim[] = [];
  const myArray = [];
  let unique: string[] = [];
  for (const claims of claimArray) {
    myArray.push(claims.shortCode);
  }
  unique = myArray.filter((v, i, a) => a.indexOf(v) === i);
  for (const claimCode of unique) {
    tempArray = claimArray.filter(claim => claim.shortCode === claimCode);
    claimHolder = tempArray[0];
    for (const temp of tempArray) {
      if (tempArray.indexOf(temp) === 0) {
        continue;
      } else {
        claimHolder.target.push(temp.target[0]);
      }
    }
    finalArray.push(claimHolder);
    claimHolder = {};
    tempArray = [];
  }
  for (const p of finalArray) {
    if (p.subject === Subject.ELA) {
      if (!p.title.includes('Performance')) {
        const titlecopy = p.title.split(' ');
        p.title = titlecopy.slice(0, 8).join(' ');
      }
    } else {
      const titlecopy = p.title.split(' ');
      if (titlecopy.includes('Grade')) {
        p.title = titlecopy.slice(0, 6).join(' ');
      } else if (titlecopy[0] === 'HS') {
        p.title = titlecopy.slice(0, 5).join(' ');
      }
    }
  }
  handlePT(finalArray);
  finalArray = removePT(finalArray);
  expandFirstClaim(finalArray);

  // This forEach fixes an error in the CASE API for E.G5.C1.T6 having an incorrect target shortcode
  finalArray.forEach(claim => {
    if (claim.shortCode === 'E.G5.C1a') {
      claim.target[claim.target.findIndex(target => target.title.includes('Target 6'))].shortCode = 'E.G5.C1RL.T6';
    }
  });

  return finalArray.filter(claim => claim.claimNumber !== 'C1' || claim.subject === Subject.MATH);
}

/**
 * Special case that splits claim C1 into C1a and C1b claims
 * @export
 * @param {IClaim[]} finalArray
 */
export function expandFirstClaim(finalArray: IClaim[]): void {
  const claimArray: IClaim[] = [];
  finalArray.forEach(claim => {
    if (claim.claimNumber === 'C1' && claim.subject === Subject.ELA) {
      const temp = JSON.parse(JSON.stringify(claim));
      temp.claimNumber = 'C1a';
      temp.shortCode = temp.shortCode.replace(claim.claimNumber, temp.claimNumber);
      temp.target = [];
      claim.target.forEach(target => {
        if (parseInt(target.shortCode.split('.')[3].split('T')[1], 10) <= 7) {
          temp.target.push(target);
        }
      });
      claim.shortCode = claim.shortCode.replace(claim.claimNumber, 'C1b');
      claim.claimNumber = 'C1b';
      claim.target = claim.target.filter(
        target => parseInt(target.shortCode.split('.')[3].split('T')[1], 10) > 7
      );
      claimArray.push(temp);
    }
  });
  claimArray.forEach(c => finalArray.push(c));
}

/**
 * Merges Targets of the type 'Performance Task' into their corresponding grade-and-claims
 * @export
 * @param {IClaim[]} finalArray
 */
export function handlePT(finalArray: IClaim[]): void {
  let PTArr: IClaim[] = [];
  let idx: number;

  PTArr = finalArray.filter(claim => claim.title.includes('Performance'));
  PTArr.forEach(PT => {
    for (const target of PT.target) {
      if (parseInt(PT.grades[0], 10) < 8) {
        idx = finalArray.findIndex(claim => {
          return claim.shortCode === target.shortCode.slice(0, 7);
        });
        finalArray[idx].target.push(target);
      }
    }
  });
}

/**
 * Excludes 'Performance Task' claims from IClaim[]
 * @param finalArray
 * @returns {IClaim[]}
 */
export function removePT(finalArray: IClaim[]): IClaim[] {
  return finalArray.filter(claim => !claim.title.includes('Performance'));
}

// tslint:disable:no-non-null-assertion
/**
 * Builds task models from Item Associations
 * @export
 * @param {string} identifier
 * @param {ISpecDocument} jsonData
 * @param {string} name
 * @returns {ITaskModel}
 */
export function getTaskModel(
  identifier: string,
  jsonData: ISpecDocument,
  name: string
): ITaskModel {
  const associations = jsonData.CFAssociations.filter(
    association => association.destinationNodeURI.identifier === identifier
  );

  const descriptionId = associations.find(
    association => association.originNodeURI.title === 'Task Description'
  )!.originNodeURI.identifier;

  const stimulusId = associations.find(
    association => association.originNodeURI.title === 'Stimulus'
  )
    ? associations.find(association => association.originNodeURI.title === 'Stimulus')!
        .originNodeURI.identifier
    : undefined;

  const stemId = associations.find(
    association => association.originNodeURI.title === 'Appropriate Stems'
  )
    ? associations.find(association => association.originNodeURI.title === 'Appropriate Stems')!
        .originNodeURI.identifier
    : undefined;

  return {
    taskName: name,
    taskDesc: jsonData.CFItems.find(item => item.identifier === descriptionId)!.fullStatement,
    stimulus: stimulusId
      ? jsonData.CFItems.find(item => item.identifier === stimulusId)!.fullStatement
      : undefined,
    stem: stemId
      ? {
          stemDesc: jsonData.CFItems.find(item => item.identifier === stemId)!.fullStatement,
          shortStem: jsonData.CFItems.find(item => item.identifier === stemId)!.abbreviatedStatement
        }
      : undefined
  };
}
